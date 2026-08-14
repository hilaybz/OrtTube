-- ============================================================
-- Fix a cross-tenant existence oracle in get_quiz_for_preview and clone_quiz,
-- and add the missing `source` field to get_quiz_for_preview's payload.
--
-- Both RPCs checked "is this quiz soft-deleted?" BEFORE checking whether the
-- caller may read it at all. A caller with no read right on a quiz in
-- another school could still distinguish quiz_not_found / quiz_deleted /
-- not_authorized from the response — confirming a quiz's existence, and
-- whether it's been deleted, in a school they have no access to. Reordered
-- so the read gate always runs first: an owner or same-school-shared caller
-- still gets quiz_deleted for a soft-deleted quiz; everyone else gets
-- not_authorized regardless of the quiz's actual state.
--
-- get_quiz_for_preview also gains 'source' on each question, which
-- 134_quiz_preview.sql omitted despite the migration's own header claiming
-- the payload mirrors get_quiz_for_author's exactly (135_author_question_source.sql
-- added it there, but not here).
-- ============================================================

create or replace function public.get_quiz_for_preview(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school    uuid;
  v_src       public.quizzes;
  v_base_lang text;
  v_quiz      jsonb;
  v_video     jsonb;
  v_questions jsonb;
  v_languages jsonb;
  v_author    text;
begin
  -- Caller must be an ACTIVE TEACHER; derive their school for the same-school
  -- read check, same precondition clone_quiz uses.
  select school_id into v_school
  from public.profiles
  where id = auth.uid() and role = 'teacher' and deactivated_at is null;
  if not found then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select * into v_src from public.quizzes where id = p_quiz_id;
  if not found then
    raise exception 'quiz_not_found' using errcode = 'P0002';
  end if;

  -- Read gate BEFORE the deleted check — a caller with no read right must
  -- never learn whether a quiz in another school exists or was deleted.
  if v_src.author_id <> auth.uid()
     and not (v_src.visibility = 'shared' and v_src.school_id = v_school) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if v_src.deleted_at is not null then
    raise exception 'quiz_deleted' using errcode = 'P0001';
  end if;

  v_base_lang := v_src.base_language;

  select display_name into v_author
  from public.profiles where id = v_src.author_id;

  -- Quiz meta + canonical video (mirrors get_quiz_for_author).
  select
    jsonb_build_object(
      'quiz_id',       q.id,
      'title',         q.title,
      'base_language', q.base_language,
      'visibility',    q.visibility
    ),
    jsonb_build_object(
      'id',                v.id,
      'youtube_video_id',  v.youtube_video_id,
      'title',             v.title,
      'channel_name',      v.channel_name,
      'duration_seconds',  v.duration_seconds,
      'transcript_status', v.transcript_status
    )
  into v_quiz, v_video
  from public.quizzes q
  join public.videos v on v.id = q.video_id
  where q.id = p_quiz_id;

  -- Non-deleted questions with base-language text and their non-deleted
  -- options — is_correct and explanation included, unlike a student read.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',               q.id,
        'kind',             q.kind,
        'position_seconds', q.position_seconds,
        'order_index',      q.order_index,
        'prompt',           qt.prompt,
        'explanation',      qt.explanation,
        'source',           qt.source,
        'options', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id',          o.id,
                'is_correct',  o.is_correct,
                'order_index', o.order_index,
                'text',        ot.text
              )
              order by o.order_index, o.id
            ),
            '[]'::jsonb
          )
          from public.question_options o
          left join public.option_translations ot
            on ot.option_id = o.id and ot.language = v_base_lang
          where o.question_id = q.id
            and o.deleted_at is null
        )
      )
      order by q.position_seconds, q.order_index, q.id
    ),
    '[]'::jsonb
  )
  into v_questions
  from public.questions q
  left join public.question_translations qt
    on qt.question_id = q.id and qt.language = v_base_lang
  where q.quiz_id = p_quiz_id
    and q.deleted_at is null;

  -- Non-base languages that already have any translation row (question or option).
  select coalesce(jsonb_agg(distinct lang), '[]'::jsonb)
  into v_languages
  from (
    select qt.language as lang
    from public.question_translations qt
    join public.questions q on q.id = qt.question_id
    where q.quiz_id = p_quiz_id
      and qt.language <> v_base_lang
    union
    select ot.language as lang
    from public.option_translations ot
    join public.question_options o on o.id = ot.option_id
    join public.questions q on q.id = o.question_id
    where q.quiz_id = p_quiz_id
      and ot.language <> v_base_lang
  ) langs;

  return v_quiz
    || jsonb_build_object(
         'video',                v_video,
         'transcript_status',    v_video->'transcript_status',
         'questions',            v_questions,
         'translated_languages', v_languages,
         'author_name',          v_author
       );
end;
$$;

create or replace function public.clone_quiz(p_source_quiz_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src      public.quizzes;
  v_school   uuid;
  v_new_quiz uuid;
  v_q        public.questions;
  v_new_qid  uuid;
  v_o        public.question_options;
  v_new_oid  uuid;
begin
  -- Caller must be an ACTIVE TEACHER; derive their school for the same-school
  -- read check and the new quiz's school_id.
  select school_id into v_school
  from public.profiles
  where id = auth.uid() and role = 'teacher' and deactivated_at is null;
  if not found then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select * into v_src from public.quizzes where id = p_source_quiz_id;
  if not found then
    raise exception 'quiz_not_found' using errcode = 'P0002';
  end if;

  -- Read gate BEFORE the deleted check — see get_quiz_for_preview above for
  -- why the order matters (a non-reader must not learn a quiz was deleted).
  -- (An owner's quiz is always in their own school, so owners pass.)
  if v_src.author_id <> auth.uid()
     and not (v_src.visibility = 'shared' and v_src.school_id = v_school) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if v_src.deleted_at is not null then
    raise exception 'quiz_deleted' using errcode = 'P0001';
  end if;

  -- New private quiz owned by the caller, REUSING the shared video row.
  insert into public.quizzes
    (author_id, video_id, school_id, title, base_language, visibility, cloned_from_id)
  values
    (auth.uid(), v_src.video_id, v_school, v_src.title, v_src.base_language,
     'private', v_src.id)
  returning id into v_new_quiz;

  -- Copy every NON-DELETED question, its translations, its non-deleted options,
  -- and those options' translations. Soft-deleted rows are intentionally dropped
  -- (a clone is a clean, current copy). Attempts/answers are never copied.
  for v_q in
    select * from public.questions
    where quiz_id = p_source_quiz_id and deleted_at is null
    order by order_index, id
  loop
    insert into public.questions (quiz_id, kind, position_seconds, order_index)
    values (v_new_quiz, v_q.kind, v_q.position_seconds, v_q.order_index)
    returning id into v_new_qid;

    insert into public.question_translations
      (question_id, language, prompt, explanation, source)
    select v_new_qid, qt.language, qt.prompt, qt.explanation, qt.source
    from public.question_translations qt
    where qt.question_id = v_q.id;

    for v_o in
      select * from public.question_options
      where question_id = v_q.id and deleted_at is null
      order by order_index, id
    loop
      insert into public.question_options (question_id, is_correct, order_index)
      values (v_new_qid, v_o.is_correct, v_o.order_index)
      returning id into v_new_oid;

      insert into public.option_translations (option_id, language, text)
      select v_new_oid, ot.language, ot.text
      from public.option_translations ot
      where ot.option_id = v_o.id;
    end loop;
  end loop;

  return v_new_quiz;
end;
$$;

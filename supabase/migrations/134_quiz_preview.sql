-- ============================================================
-- Preview read: get_quiz_for_preview(quiz_id) — backlog 1.3 / issue #13
--
-- Lets a teacher see a quiz's full content (video, timeline, every question
-- and option, correct answers and explanations included) BEFORE cloning it,
-- instead of cloning blind. Gated exactly like clone_quiz (owner, OR the
-- quiz is `shared` in the caller's own school) — deliberately NOT gated like
-- get_quiz_for_author (owner-only), and deliberately NOT correctness-free.
--
-- Why the answer key is included, reversing this backlog item's original
-- note: cloning already hands a same-school teacher the full answer key the
-- instant they clone (a deep copy, editable in their own editor from then
-- on) — withholding it in the preview adds friction (clone-to-see-answers)
-- without adding any actual protection, since a same-school teacher already
-- has a one-click path to the same data. The real trust boundary is "same
-- school, active teacher, owner-or-shared" — clone_quiz's own gate — not
-- "never show a non-owner the answer key."
--
-- Why this is a SEPARATE RPC rather than widening get_quiz_for_author's own
-- gate: the editor page (get_quiz_for_author's only caller) assumes
-- "if I can fetch this, I own it" throughout — edit/delete/drag controls
-- render unconditionally once data loads. Widening that RPC's gate without
-- rebuilding the editor page would let a non-owner load a UI full of
-- controls that silently fail ownership checks when clicked. A separate
-- read-only preview surface avoids that entirely.
--
-- The SQL body otherwise mirrors get_quiz_for_author's query tree exactly
-- (base-language only, same shape) — see 123_get_quiz_for_author.sql.
--
-- Stable error codes (raised as the exception MESSAGE; SQLSTATE P0001/P0002),
-- matching clone_quiz's:
--   not_authorized  — caller is not an active teacher, or may not read the quiz
--   quiz_not_found  — quiz id does not exist
--   quiz_deleted    — quiz is soft-deleted
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
  if v_src.deleted_at is not null then
    raise exception 'quiz_deleted' using errcode = 'P0001';
  end if;

  -- Read gate: the caller must own the quiz, or it must be shared in their
  -- school — identical to clone_quiz's gate (080_sharing_rpcs.sql).
  if v_src.author_id <> auth.uid()
     and not (v_src.visibility = 'shared' and v_src.school_id = v_school) then
    raise exception 'not_authorized' using errcode = 'P0001';
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
      order by q.order_index, q.position_seconds, q.id
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

revoke all on function public.get_quiz_for_preview(uuid) from public;
grant execute on function public.get_quiz_for_preview(uuid) to authenticated, service_role;

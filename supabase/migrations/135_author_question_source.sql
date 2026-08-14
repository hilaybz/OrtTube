-- ============================================================
-- get_quiz_for_author gains `source` per question (code review finding,
-- 2026-08-14) — the editor needs it to round-trip AI-generated questions'
-- provenance through the position-only save the checkpoint timeline's
-- drag-to-reposition reuses.
--
-- The bug: dragging a marker calls the SAME full-question-upsert endpoint
-- `QuestionModal` uses (there is no lightweight position-only RPC), which
-- requires a `source` in its body. The editor never had one to send (this
-- RPC didn't return it), so the endpoint defaulted every drag to `authored`
-- — silently rewriting an AI-generated question's `question_translations.source`
-- to `authored` on a save the teacher only meant to reposition. `source`
-- carries no grading/correctness weight (`question_options.is_correct` is
-- untouched either way), so this was never a correctness bug, only a wrong
-- provenance flag that then propagates through `clone_quiz`.
--
-- No RETURNS TABLE shape changes here (this RPC returns a single `jsonb`),
-- so a plain `create or replace` is enough — no drop-first needed.
-- ============================================================

create or replace function public.get_quiz_for_author(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_lang text;
  v_quiz      jsonb;
  v_video     jsonb;
  v_questions jsonb;
  v_languages jsonb;
begin
  -- Owner check (author of the quiz, non-deactivated), matching analytics.
  if not exists (
    select 1
    from public.quizzes q
    join public.profiles p on p.id = q.author_id
    where q.id = p_quiz_id
      and q.author_id = auth.uid()
      and p.deactivated_at is null
  ) then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  select base_language into v_base_lang from public.quizzes where id = p_quiz_id;

  -- Quiz meta + canonical video.
  select
    jsonb_build_object(
      'quiz_id',       q.id,
      'title',         q.title,
      'base_language', q.base_language,
      'visibility',    q.visibility
    ),
    jsonb_build_object(
      'id',               v.id,
      'youtube_video_id', v.youtube_video_id,
      'title',            v.title,
      'duration_seconds', v.duration_seconds,
      'transcript_status', v.transcript_status
    )
  into v_quiz, v_video
  from public.quizzes q
  join public.videos v on v.id = q.video_id
  where q.id = p_quiz_id;

  -- Non-deleted questions with base-language text and their non-deleted options.
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
         'translated_languages', v_languages
       );
end;
$$;

revoke all on function public.get_quiz_for_author(uuid) from public;
grant execute on function public.get_quiz_for_author(uuid) to authenticated, service_role;

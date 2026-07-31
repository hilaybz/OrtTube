-- ============================================================
-- Student attempt-state read (frontend P1, design spec §11-B)
--
-- list_my_attempts_for_quiz(class_id, quiz_id) — SECURITY DEFINER. One round-trip
-- that gives the student UI everything it needs that the other student reads do
-- NOT expose:
--   • delivery context the player needs on a deep-link/refresh — youtube_video_id,
--     video title/duration, tutor_mode, max_attempts (get_quiz_for_student omits
--     all of these),
--   • attempt state for the feed status chips and the "no attempts left" gate —
--     attempt_count, completed_count, attempts_left (null = unlimited),
--   • resume target (newest incomplete attempt id),
--   • the newest COMPLETED attempt id + its score — the ONLY way to reach the
--     reveal-gated review on a revisit, since start_or_resume_attempt raises
--     no_attempts_left exactly at the reveal condition and never returns an id.
--
-- Reveal is still enforced downstream by get_attempt_review; this read never
-- returns per-question correctness or the answer key.
--
-- Called through the AUTHENTICATED (RLS-subject) client so auth.uid() is the
-- signed-in student; the membership gate authorizes the elevated internal reads.
--
-- Stable error codes (SQLSTATE P0001/P0002): unauthorized, not_member, not_assigned.
-- ============================================================

create or replace function public.list_my_attempts_for_quiz(
  p_class_id uuid,
  p_quiz_id  uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_student        uuid := auth.uid();
  v_tutor_mode     text;
  v_max_attempts   int;
  v_base_language  text;
  v_youtube_id     text;
  v_video_title    text;
  v_duration       int;
  v_attempt_count  int;
  v_completed      int;
  v_attempts_left  int;
  v_resume_id      uuid;
  v_last_completed public.attempts;
begin
  if v_student is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  if not public.is_member_of_class(p_class_id) then
    raise exception 'not_member' using errcode = 'P0001';
  end if;

  -- Assignment + content context in one join (quiz must be non-deleted).
  select cq.tutor_mode, cq.max_attempts, q.base_language,
         v.youtube_video_id, v.title, v.duration_seconds
    into v_tutor_mode, v_max_attempts, v_base_language,
         v_youtube_id, v_video_title, v_duration
    from public.class_quizzes cq
    join public.quizzes q on q.id = cq.quiz_id
    join public.videos  v on v.id = q.video_id
   where cq.class_id = p_class_id
     and cq.quiz_id  = p_quiz_id
     and q.deleted_at is null;
  if not found then
    raise exception 'not_assigned' using errcode = 'P0002';
  end if;

  select
    count(*),
    count(*) filter (where completed_at is not null)
    into v_attempt_count, v_completed
  from public.attempts
  where student_id = v_student and class_id = p_class_id and quiz_id = p_quiz_id;

  -- null max_attempts = unlimited (attempts_left stays null).
  v_attempts_left := case
    when v_max_attempts is null then null
    else greatest(v_max_attempts - v_completed, 0)
  end;

  -- Newest incomplete attempt (resume target), if any.
  select id into v_resume_id
  from public.attempts
  where student_id = v_student and class_id = p_class_id and quiz_id = p_quiz_id
    and completed_at is null
  order by attempt_no desc
  limit 1;

  -- Newest completed attempt (score + review entry point), if any.
  select * into v_last_completed
  from public.attempts
  where student_id = v_student and class_id = p_class_id and quiz_id = p_quiz_id
    and completed_at is not null
  order by attempt_no desc
  limit 1;

  return jsonb_build_object(
    'class_id',                 p_class_id,
    'quiz_id',                  p_quiz_id,
    'youtube_video_id',         v_youtube_id,
    'video_title',              v_video_title,
    'duration_seconds',         v_duration,
    'base_language',            v_base_language,
    'tutor_mode',               v_tutor_mode,
    'max_attempts',             v_max_attempts,
    'attempt_count',            v_attempt_count,
    'completed_count',          v_completed,
    'attempts_left',            v_attempts_left,
    'in_progress',              v_resume_id is not null,
    'resume_attempt_id',        v_resume_id,
    'last_completed_attempt_id',v_last_completed.id,
    'last_num_correct',         v_last_completed.num_correct,
    'last_num_questions',       v_last_completed.num_questions
  );
end;
$$;

revoke all on function public.list_my_attempts_for_quiz(uuid, uuid) from public;
grant execute on function public.list_my_attempts_for_quiz(uuid, uuid) to authenticated, service_role;

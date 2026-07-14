-- ============================================================
-- Complete an attempt (spec §3.5)
--
-- complete_attempt(attempt_id) — SECURITY DEFINER: stamps completed_at and writes
-- the score derived entirely from snapshots:
--   • num_questions = count of attempt_questions (the frozen start snapshot),
--   • num_correct   = count of answers.was_correct (per-answer snapshots),
-- so editing the quiz or its answer key afterwards never changes a past score.
--
-- Idempotent: completing an already-completed attempt returns the stored summary
-- unchanged (max_attempts counts completed attempts, so re-stamping must not
-- create a second completion or move completed_at).
--
-- Stable error codes: unauthorized, attempt_not_found, not_your_attempt.
-- ============================================================

create or replace function public.complete_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid := auth.uid();
  v_attempt public.attempts;
  v_num_questions   int;
  v_num_correct   int;
begin
  if v_student is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  select * into v_attempt from public.attempts where id = p_attempt_id;
  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;
  if v_attempt.student_id is distinct from v_student then
    raise exception 'not_your_attempt' using errcode = 'P0001';
  end if;

  select count(*) into v_num_questions
  from public.attempt_questions where attempt_id = p_attempt_id;

  select count(*) into v_num_correct
  from public.answers where attempt_id = p_attempt_id and was_correct;

  -- Only stamp once; a repeat call is a no-op that echoes the stored summary.
  if v_attempt.completed_at is null then
    update public.attempts
      set completed_at  = now(),
          num_questions = v_num_questions,
          num_correct   = v_num_correct
      where id = p_attempt_id
      returning * into v_attempt;
  end if;

  return jsonb_build_object(
    'attempt_id',    v_attempt.id,
    'attempt_no',    v_attempt.attempt_no,
    'completed_at',  v_attempt.completed_at,
    'num_questions', coalesce(v_attempt.num_questions, v_num_questions),
    'num_correct',   coalesce(v_attempt.num_correct, v_num_correct)
  );
end;
$$;

revoke all on function public.complete_attempt(uuid) from public;
grant execute on function public.complete_attempt(uuid) to authenticated, service_role;

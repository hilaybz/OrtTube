-- ============================================================
-- Submit an answer, graded server-side (spec §3.5)
--
-- submit_answer(attempt_id, question_id, option_ids[]) — SECURITY DEFINER:
--   • verifies the attempt belongs to the caller and is incomplete,
--   • verifies the question is in THIS attempt's snapshot (attempt_questions),
--   • grades server-side against the live answer key:
--       single -> the one chosen option is the correct one,
--       multi  -> the chosen set exactly equals the correct set,
--     (both reduce to exact-set equality of the chosen vs. the live correct set),
--   • writes answers.was_correct as a SNAPSHOT + the answer_selections, so a later
--     answer-key edit never rewrites this grade (spec §3.5).
--
-- Idempotency: one answer per (attempt_id, question_id) — a re-submit is
-- REJECTED as `already_answered` (documented default; the UNIQUE constraint is
-- the backstop, caught below). The answer key (is_correct) is NEVER returned;
-- per-question correctness is not echoed to the client either.
--
-- Stable error codes: unauthorized, attempt_not_found, not_your_attempt,
--   attempt_completed, question_not_in_attempt, invalid_selection_count,
--   invalid_option, already_answered.
-- ============================================================

create or replace function public.submit_answer(
  p_attempt_id  uuid,
  p_question_id uuid,
  p_option_ids  uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student       uuid := auth.uid();
  v_attempt       public.attempts;
  v_kind          text;
  v_submitted     uuid[];
  v_correct_count int;
  v_match_count   int;
  v_was_correct   boolean;
  v_answer_id     uuid;
  v_opt           uuid;
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
  if v_attempt.completed_at is not null then
    raise exception 'attempt_completed' using errcode = 'P0001';
  end if;

  -- The question must belong to this attempt's frozen snapshot.
  if not exists (
    select 1 from public.attempt_questions aq
    where aq.attempt_id = p_attempt_id and aq.question_id = p_question_id
  ) then
    raise exception 'question_not_in_attempt' using errcode = 'P0002';
  end if;

  -- Reject a duplicate answer up front (UNIQUE is the race backstop, below).
  if exists (
    select 1 from public.answers
    where attempt_id = p_attempt_id and question_id = p_question_id
  ) then
    raise exception 'already_answered' using errcode = 'P0001';
  end if;

  select kind into v_kind from public.questions where id = p_question_id;

  -- Normalise the submitted ids: drop nulls + duplicates.
  select array_agg(distinct x) into v_submitted
  from unnest(coalesce(p_option_ids, '{}'::uuid[])) as x
  where x is not null;
  v_submitted := coalesce(v_submitted, '{}'::uuid[]);

  -- A submission needs at least one option; single-choice needs exactly one.
  if array_length(v_submitted, 1) is null then
    raise exception 'invalid_selection_count' using errcode = 'P0001';
  end if;
  if v_kind = 'single' and array_length(v_submitted, 1) <> 1 then
    raise exception 'invalid_selection_count' using errcode = 'P0001';
  end if;

  -- Every submitted option must be a LIVE option of this question (a student may
  -- not select a soft-deleted distractor into a new answer).
  if exists (
    select 1 from unnest(v_submitted) sid
    where not exists (
      select 1 from public.question_options o
      where o.id = sid and o.question_id = p_question_id and o.deleted_at is null
    )
  ) then
    raise exception 'invalid_option' using errcode = 'P0001';
  end if;

  -- Grade against the live correct set. was_correct is true iff the chosen set
  -- exactly equals the correct set (all chosen are correct AND all correct chosen).
  select count(*) into v_correct_count
  from public.question_options
  where question_id = p_question_id and is_correct and deleted_at is null;

  select count(*) into v_match_count
  from public.question_options o
  where o.question_id = p_question_id and o.is_correct and o.deleted_at is null
    and o.id = any(v_submitted);

  v_was_correct := (v_match_count = v_correct_count)
                   and (v_match_count = array_length(v_submitted, 1));

  insert into public.answers (attempt_id, question_id, was_correct)
  values (p_attempt_id, p_question_id, v_was_correct)
  returning id into v_answer_id;

  foreach v_opt in array v_submitted loop
    insert into public.answer_selections (answer_id, option_id)
    values (v_answer_id, v_opt);
  end loop;

  -- Deliberately does NOT echo was_correct (no answer-key / correctness leak).
  return jsonb_build_object(
    'attempt_id',  p_attempt_id,
    'question_id', p_question_id,
    'recorded',    true
  );
exception
  when unique_violation then
    -- Concurrent double-submit for the same (attempt, question).
    raise exception 'already_answered' using errcode = 'P0001';
end;
$$;

revoke all on function public.submit_answer(uuid, uuid, uuid[]) from public;
grant execute on function public.submit_answer(uuid, uuid, uuid[]) to authenticated, service_role;

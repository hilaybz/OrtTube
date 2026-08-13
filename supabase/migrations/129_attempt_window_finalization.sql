-- ============================================================
-- Hard-cutoff attempt finalization at a window's close (Epic 2A.2)
--
-- Decision: when `available_until` passes, a student mid-attempt is treated as
-- having submitted right then — unanswered questions count wrong, scored on
-- whatever they'd actually answered. Three paths can trigger this, and all
-- three go through ONE scoring routine so there is no risk of them disagreeing:
--
--   • submit_answer   — the primary path. A student still interacting hits the
--     window the moment they try to answer past it; the attempt is finalized
--     right there, near-real-time, no cron lag.
--   • complete_attempt — a student who clicks submit after the window has
--     already passed gets backdated to the window's close, not `now()`, so
--     both paths agree on when the attempt "really" ended.
--   • close_expired_attempt_windows — an hourly sweep (see the job route) for
--     attempts nobody ever came back to interact with. This is a correctness
--     backstop for analytics (an abandoned attempt would otherwise stay
--     `completed_at is null` forever), not the primary mechanism — the two
--     paths above already handle anyone actually present.
--
-- `completed_at` is always stamped as the WINDOW'S close time, never wall-clock
-- `now()` (except when there's no window at all) — an attempt finalized by a
-- 18:05 sweep run still reads as completed at 18:00.
--
-- No `answers` backfill is needed for "unanswered = wrong": an unanswered
-- question simply has no `answers` row, and `complete_attempt` already counted
-- correctness by `count(*) ... and was_correct`, which excludes it by omission.
--
-- get_attempt_review's reveal gate also widens here: a closed window means no
-- retake remains, exactly like an exhausted max_attempts, so a windowed quiz
-- doesn't dead-end into "never reveals" the way issue #67 (4.9) describes for
-- unlimited attempts. Same bug shape, fixed here only for the window case.
-- ============================================================

-- ── _finalize_attempt_scores ──────────────────────────────────────────────────
-- The one scoring implementation: attempt_questions count, answers.was_correct
-- count, stamp completed_at. Returns whether it actually finalized (false when
-- the attempt was already completed) so callers — the cron sweep in
-- particular — can tell a real finalization from a no-op.
--
-- Locks the attempts row FIRST, before counting. This closes a race the
-- three call sites don't otherwise guard against: submit_answer inserts into
-- `answers` in the same transaction it later finalizes in, but a concurrent
-- caller (the cron sweep, or two overlapping requests) could count `answers`
-- in between the insert and that transaction's commit and never see it —
-- READ COMMITTED does not make an in-flight, uncommitted insert visible.
-- Locking here forces whichever caller gets there first to fully finish
-- (finalize-or-not, commit-or-not) before the other proceeds, so the count
-- always reflects a settled state. `submit_answer` takes the SAME lock on
-- its own initial read of the attempt for exactly this reason — it must
-- happen before that transaction inserts into `answers`, not just before it
-- calls this function, or the two locks wouldn't overlap in time and the
-- race would remain.
create or replace function public._finalize_attempt_scores(
  p_attempt_id   uuid,
  p_completed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already_done  boolean;
  v_num_questions int;
  v_num_correct   int;
begin
  select completed_at is not null into v_already_done
  from public.attempts where id = p_attempt_id
  for update;

  if v_already_done is null or v_already_done then
    return false;
  end if;

  select count(*) into v_num_questions
  from public.attempt_questions where attempt_id = p_attempt_id;

  select count(*) into v_num_correct
  from public.answers where attempt_id = p_attempt_id and was_correct;

  update public.attempts
    set completed_at  = p_completed_at,
        num_questions = v_num_questions,
        num_correct   = v_num_correct
    where id = p_attempt_id;

  return true;
end;
$$;

-- service_role ONLY. This has no auth.uid() / ownership check of its own —
-- the three SECURITY DEFINER callers (complete_attempt, submit_answer,
-- close_expired_attempt_windows) are what authorize a call, by running as the
-- owner regardless of who invoked them. Granting this to `authenticated`
-- would let any signed-in user force-complete an arbitrary attempt_id with an
-- arbitrary completed_at directly over PostgREST — a stray copy-paste from
-- the read-only helpers (_assert_class_owner, _allocation_is_live) that DO
-- need the authenticated grant because callers invoke them directly.
revoke all on function public._finalize_attempt_scores(uuid, timestamptz) from public;
grant execute on function public._finalize_attempt_scores(uuid, timestamptz) to service_role;

-- ── complete_attempt ──────────────────────────────────────────────────────────
-- Reproduced from 063_complete_attempt.sql, refactored onto the shared helper.
-- Backdates to the allocation's available_until when one exists and has
-- passed, so a late click can't stamp a time past the window.
create or replace function public.complete_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid := auth.uid();
  v_attempt public.attempts;
  v_until   timestamptz;
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

  select available_until into v_until
  from public.class_quizzes
  where class_id = v_attempt.class_id and quiz_id = v_attempt.quiz_id;

  perform public._finalize_attempt_scores(
    p_attempt_id,
    case when v_until is not null then least(now(), v_until) else now() end
  );

  select * into v_attempt from public.attempts where id = p_attempt_id;

  return jsonb_build_object(
    'attempt_id',    v_attempt.id,
    'attempt_no',    v_attempt.attempt_no,
    'completed_at',  v_attempt.completed_at,
    'num_questions', v_attempt.num_questions,
    'num_correct',   v_attempt.num_correct
  );
end;
$$;

revoke all on function public.complete_attempt(uuid) from public;
grant execute on function public.complete_attempt(uuid) to authenticated, service_role;

-- ── submit_answer ─────────────────────────────────────────────────────────────
-- Reproduced from 062_submit_answer.sql with one addition, right after the
-- existing ownership/not-completed checks: if the allocation's window has
-- already closed, finalize the attempt and return { window_closed: true }
-- instead of recording the answer. This is a RETURN, not a raise — raising
-- would abort the transaction and roll back the finalizing UPDATE, leaving the
-- attempt open forever with nothing left to close it short of the sweep.
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
  v_until         timestamptz;
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

  -- Locked from this first read: it must be held before the answers insert
  -- below, not just before _finalize_attempt_scores is called, so it
  -- actually overlaps a concurrent cron-sweep lock on the same row and the
  -- two calls serialize instead of racing (see _finalize_attempt_scores).
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;
  if v_attempt.student_id is distinct from v_student then
    raise exception 'not_your_attempt' using errcode = 'P0001';
  end if;
  if v_attempt.completed_at is not null then
    raise exception 'attempt_completed' using errcode = 'P0001';
  end if;

  select available_until into v_until
  from public.class_quizzes
  where class_id = v_attempt.class_id and quiz_id = v_attempt.quiz_id;

  if v_until is not null and v_until <= now() then
    perform public._finalize_attempt_scores(p_attempt_id, v_until);
    return jsonb_build_object(
      'attempt_id',    p_attempt_id,
      'question_id',   p_question_id,
      'recorded',      false,
      'window_closed', true
    );
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
    'attempt_id',    p_attempt_id,
    'question_id',   p_question_id,
    'recorded',      true,
    'window_closed', false
  );
exception
  when unique_violation then
    -- Concurrent double-submit for the same (attempt, question).
    raise exception 'already_answered' using errcode = 'P0001';
end;
$$;

revoke all on function public.submit_answer(uuid, uuid, uuid[]) from public;
grant execute on function public.submit_answer(uuid, uuid, uuid[]) to authenticated, service_role;

-- ── get_attempt_review ────────────────────────────────────────────────────────
-- Reproduced from 064_get_attempt_review.sql. v_exhausted widens to also cover
-- a closed window: no retake remains either because max_attempts is used up,
-- or because the window that gated retaking has closed.
create or replace function public.get_attempt_review(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student       uuid := auth.uid();
  v_attempt       public.attempts;
  v_num_questions int;
  v_num_correct   int;
  v_completed     int;
  v_max           int;
  v_until         timestamptz;
  v_pref          text;
  v_class_lang    text;
  v_base          text;
  v_resolved      text;
  v_exhausted     boolean;
  v_questions     jsonb;
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

  -- Not finished → nothing to reveal, not even a score.
  if v_attempt.completed_at is null then
    return jsonb_build_object('revealed', false, 'completed', false);
  end if;

  -- Aggregate score from the frozen snapshots (mirrors complete_attempt).
  select count(*) into v_num_questions
  from public.attempt_questions where attempt_id = p_attempt_id;
  select count(*) into v_num_correct
  from public.answers where attempt_id = p_attempt_id and was_correct;

  -- Completed attempts for this (student, class, quiz) + the attempt cap + window.
  select count(*) into v_completed
  from public.attempts
  where student_id = v_student
    and class_id   = v_attempt.class_id
    and quiz_id    = v_attempt.quiz_id
    and completed_at is not null;

  select max_attempts, available_until into v_max, v_until
  from public.class_quizzes
  where class_id = v_attempt.class_id and quiz_id = v_attempt.quiz_id;

  -- Reveal when no retake remains: the cap is finite and used up, OR the
  -- window that gated retaking has closed. Unlimited attempts with no window
  -- never reveal per-question detail.
  v_exhausted := (v_max is not null and v_completed >= v_max)
              or (v_until is not null and v_until <= now());

  if not v_exhausted then
    return jsonb_build_object(
      'revealed',      false,
      'completed',     true,
      'num_correct',   v_num_correct,
      'num_questions', v_num_questions
    );
  end if;

  -- Resolve the explanation language (same precedence as get_quiz_for_student).
  select preferred_language into v_pref from public.profiles where id = v_student;
  select language into v_class_lang from public.classes where id = v_attempt.class_id;
  select base_language into v_base from public.quizzes where id = v_attempt.quiz_id;
  v_resolved := coalesce(
    case when v_pref       in ('he','ar','en') then v_pref       end,
    case when v_class_lang in ('he','ar','en') then v_class_lang end,
    v_base
  );

  -- Per-question review over the attempt's frozen snapshot.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'question_id',        aq.question_id,
             'was_correct',        ans.was_correct,
             'correct_option_ids', coalesce((
                 select jsonb_agg(o.id order by o.order_index, o.id)
                 from public.question_options o
                 where o.question_id = aq.question_id
                   and o.is_correct
                   and o.deleted_at is null
               ), '[]'::jsonb),
             'explanation',        case when qt_r.question_id is not null
                                        then qt_r.explanation else qt_b.explanation end,
             'selected_option_ids', coalesce((
                 select jsonb_agg(sel.option_id)
                 from public.answer_selections sel
                 where sel.answer_id = ans.id
               ), '[]'::jsonb)
           )
           order by aq.order_index, aq.question_id
         ), '[]'::jsonb)
    into v_questions
  from public.attempt_questions aq
  left join public.answers ans
    on ans.attempt_id = aq.attempt_id and ans.question_id = aq.question_id
  left join public.question_translations qt_r
    on qt_r.question_id = aq.question_id and qt_r.language = v_resolved
  left join public.question_translations qt_b
    on qt_b.question_id = aq.question_id and qt_b.language = v_base
  where aq.attempt_id = p_attempt_id;

  return jsonb_build_object(
    'revealed',      true,
    'completed',     true,
    'num_correct',   v_num_correct,
    'num_questions', v_num_questions,
    'questions',     v_questions
  );
end;
$$;

revoke all on function public.get_attempt_review(uuid) from public;
grant execute on function public.get_attempt_review(uuid) to authenticated, service_role;

-- ── close_expired_attempt_windows ─────────────────────────────────────────────
-- The hourly sweep backstop (see app/api/jobs/close-attempt-windows). Finds
-- attempts nobody ever came back to interact with after their window closed —
-- the two interactive paths above already handle anyone still present, so this
-- exists purely so analytics don't understate completion for abandoned
-- attempts. service_role only, same shape as the other job RPCs in
-- 110_jobs_rpcs.sql; idempotent by construction via _finalize_attempt_scores's
-- own `completed_at is null` guard, so an overlapping run is harmless.
create or replace function public.close_expired_attempt_windows(p_batch_limit int default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closed int := 0;
  v_row    record;
begin
  if p_batch_limit is null or p_batch_limit < 1 then
    raise exception 'close_expired_attempt_windows: p_batch_limit must be a positive integer (got %)', p_batch_limit
      using errcode = 'OT400';
  end if;

  -- ORDER BY + SKIP LOCKED: two overlapping runs (a manual trigger racing the
  -- schedule, a platform retry) must not deadlock or double-count. Ordering
  -- means any run that does block, blocks in a consistent order (no cycles);
  -- SKIP LOCKED means the common case doesn't even block — an overlapping run
  -- just takes the rows the first one hasn't reached yet.
  for v_row in
    select a.id, cq.available_until
    from public.attempts a
    join public.class_quizzes cq
      on cq.class_id = a.class_id and cq.quiz_id = a.quiz_id
    where a.completed_at is null
      and cq.available_until is not null
      and cq.available_until <= now()
    order by a.id
    limit p_batch_limit
    for update of a skip locked
  loop
    -- Count only attempts THIS call actually finalized — a row already closed
    -- by a concurrent submit_answer/complete_attempt between the select above
    -- and this call returns false, and must not inflate the count.
    if public._finalize_attempt_scores(v_row.id, v_row.available_until) then
      v_closed := v_closed + 1;
    end if;
  end loop;

  return jsonb_build_object('closed', v_closed);
end;
$$;

revoke all on function public.close_expired_attempt_windows(int) from public;
grant execute on function public.close_expired_attempt_windows(int) to service_role;

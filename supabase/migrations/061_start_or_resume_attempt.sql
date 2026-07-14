-- ============================================================
-- Start / resume an attempt (spec §3.5)
--
-- start_or_resume_attempt(class_id, quiz_id) — SECURITY DEFINER, transactional:
--   • verifies membership + assignment (+ quiz non-deleted),
--   • RESUMES the newest incomplete attempt for (student, class, quiz) if one
--     exists, returning the already-answered question_ids (never the correctness)
--     so the client can skip them,
--   • else enforces max_attempts, counting ONLY completed attempts (null =
--     unlimited; an abandoned attempt never burns one),
--   • else allocates the next attempt_no under a short xact advisory lock
--     (pooler-safe, §0) and creates the attempt,
--   • SNAPSHOTS the live, non-deleted question set into attempt_questions so a
--     mid-flight quiz edit cannot change this attempt's num_questions / scoring
--     basis (a count alone can't answer snapshot membership, and questions has no
--     created_at to reconstruct it — spec §3.5).
--
-- attempts.student_id is behavioural-write-protected (SELECT-only grant); writes
-- flow through this RPC. UNIQUE(student_id, class_id, quiz_id, attempt_no) is the
-- backstop for the attempt_no allocation.
--
-- Stable error codes: unauthorized, not_member, not_assigned, no_attempts_left.
-- ============================================================

create or replace function public.start_or_resume_attempt(
  p_class_id uuid,
  p_quiz_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student   uuid := auth.uid();
  v_cq        public.class_quizzes;
  v_existing  public.attempts;
  v_completed int;
  v_next_no   int;
  v_attempt   public.attempts;
  v_answered  jsonb;
begin
  if v_student is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.class_members m
    where m.class_id = p_class_id and m.student_id = v_student
  ) then
    raise exception 'not_member' using errcode = 'P0001';
  end if;

  select cq.* into v_cq
  from public.class_quizzes cq
  join public.quizzes q on q.id = cq.quiz_id
  where cq.class_id = p_class_id and cq.quiz_id = p_quiz_id and q.deleted_at is null;
  if not found then
    raise exception 'not_assigned' using errcode = 'P0002';
  end if;

  -- Serialize the whole allocation for this (student, class, quiz). The lock is
  -- transaction-scoped, so it is held only for this quick txn — safe under the
  -- transaction-mode pooler (plan §0). Taken before the resume/max checks so two
  -- concurrent starts cannot both pass max_attempts or both allocate the same no.
  perform pg_advisory_xact_lock(
    hashtextextended(v_student::text || '|' || p_class_id::text || '|' || p_quiz_id::text, 0)
  );

  -- Resume the newest incomplete attempt, if any.
  select * into v_existing
  from public.attempts
  where student_id = v_student and class_id = p_class_id and quiz_id = p_quiz_id
    and completed_at is null
  order by attempt_no desc
  limit 1;

  if found then
    select coalesce(jsonb_agg(question_id), '[]'::jsonb) into v_answered
    from public.answers where attempt_id = v_existing.id;
    return jsonb_build_object(
      'attempt_id',            v_existing.id,
      'attempt_no',            v_existing.attempt_no,
      'resumed',               true,
      'started_at',            v_existing.started_at,
      'answered_question_ids', v_answered
    );
  end if;

  -- Enforce max_attempts — completed attempts only.
  select count(*) into v_completed
  from public.attempts
  where student_id = v_student and class_id = p_class_id and quiz_id = p_quiz_id
    and completed_at is not null;

  if v_cq.max_attempts is not null and v_completed >= v_cq.max_attempts then
    raise exception 'no_attempts_left' using errcode = 'P0001';
  end if;

  select coalesce(max(attempt_no), 0) + 1 into v_next_no
  from public.attempts
  where student_id = v_student and class_id = p_class_id and quiz_id = p_quiz_id;

  insert into public.attempts (student_id, class_id, quiz_id, attempt_no)
  values (v_student, p_class_id, p_quiz_id, v_next_no)
  returning * into v_attempt;

  -- Materialize the start-time question snapshot.
  insert into public.attempt_questions (attempt_id, question_id, order_index)
  select v_attempt.id, q.id, q.order_index
  from public.questions q
  where q.quiz_id = p_quiz_id and q.deleted_at is null;

  return jsonb_build_object(
    'attempt_id',            v_attempt.id,
    'attempt_no',            v_attempt.attempt_no,
    'resumed',               false,
    'started_at',            v_attempt.started_at,
    'answered_question_ids', '[]'::jsonb
  );
end;
$$;

revoke all on function public.start_or_resume_attempt(uuid, uuid) from public;
grant execute on function public.start_or_resume_attempt(uuid, uuid) to authenticated, service_role;

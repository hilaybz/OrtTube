-- ============================================================
-- Analytics: class_stats(class_id)
-- Per-assigned-quiz stats for a class.
--
-- Two intentionally distinct completion figures (spec §6.2, analytics acceptance) —
-- do NOT conflate them:
--   * completion_count  — ATTEMPT-based: every completed attempt row for
--                         (class, quiz), so anonymized attempts (deleted/departed
--                         students, `student_id IS NULL`) still count. This is the
--                         headline "how many completions happened".
--   * members_completed — ROSTER-based: distinct CURRENT class members with a
--                         completed attempt. Reads as "N of `current_member_count`
--                         current members completed". Necessarily excludes
--                         anonymized/departed students.
--
-- Averages are attempt-based (over completed, gradeable attempts) so anonymized
-- attempts still count. Owner-checked against `auth.uid()` (class teacher, not
-- deactivated).
-- ============================================================

create or replace function public.class_stats(p_class_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_count int;
  v_quizzes jsonb;
begin
  -- Owner check: caller must own the class and not be deactivated.
  if not public.is_teacher_of_class(p_class_id) then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  select count(*) into v_member_count
  from public.class_members where class_id = p_class_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'quiz_id', cq.quiz_id,
        'title', z.title,
        'deleted', (z.deleted_at is not null),
        'tutor_mode', cq.tutor_mode,
        'max_attempts', cq.max_attempts,
        'attempt_count', (
          select count(*) from public.attempts a
          where a.class_id = p_class_id and a.quiz_id = cq.quiz_id
        ),
        -- Attempt-based: includes anonymized attempts.
        'completion_count', (
          select count(*) from public.attempts a
          where a.class_id = p_class_id and a.quiz_id = cq.quiz_id
            and a.completed_at is not null
        ),
        'average_score', (
          select avg((a.num_correct::numeric) / nullif(a.num_questions, 0))
          from public.attempts a
          where a.class_id = p_class_id and a.quiz_id = cq.quiz_id
            and a.completed_at is not null
            and a.num_questions is not null
            and a.num_questions > 0
        ),
        -- Roster-based: distinct current members who completed (excludes
        -- anonymized/departed students by construction).
        'members_completed', (
          select count(distinct a.student_id)
          from public.attempts a
          where a.class_id = p_class_id and a.quiz_id = cq.quiz_id
            and a.completed_at is not null
            and a.student_id is not null
            and exists (
              select 1 from public.class_members m
              where m.class_id = p_class_id and m.student_id = a.student_id
            )
        ),
        'current_member_count', v_member_count
      )
      order by cq.assigned_at, cq.quiz_id
    ),
    '[]'::jsonb
  )
  into v_quizzes
  from public.class_quizzes cq
  join public.quizzes z on z.id = cq.quiz_id
  where cq.class_id = p_class_id;

  return jsonb_build_object(
    'class_id', p_class_id,
    'current_member_count', v_member_count,
    'quizzes', v_quizzes
  );
end;
$$;

revoke execute on function public.class_stats(uuid) from public;
grant execute on function public.class_stats(uuid) to authenticated, service_role;

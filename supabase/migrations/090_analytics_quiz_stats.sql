-- ============================================================
-- Analytics: quiz_stats(quiz_id)
-- Compute-on-read, owner-checked. No rollup tables in v1 (spec §6.2).
--
-- Returns quiz-level completion count, attempt count, and average score,
-- computed live from `attempts`. Anonymized attempts (`student_id IS NULL`)
-- still count toward totals/averages because we count attempt ROWS, not
-- distinct students (spec §6.2, analytics acceptance).
--
-- SECURITY DEFINER so it can read across RLS; ownership is enforced explicitly
-- against `auth.uid()` (the caller must be the quiz author and a non-deactivated
-- teacher). Called with the signed-in teacher's client, NOT the service client
-- (service-role has no `auth.uid()`).
-- ============================================================

create or replace function public.quiz_stats(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  -- Owner check: caller must be the quiz's author and not deactivated.
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

  select jsonb_build_object(
    'quiz_id', p_quiz_id,
    -- Attempt-based counts: every attempt row, including anonymized ones.
    'attempt_count', count(*),
    'completion_count', count(*) filter (where a.completed_at is not null),
    -- Mean fraction correct (0..1) over completed, gradeable attempts.
    'average_score', avg(
      (a.num_correct::numeric) / nullif(a.num_questions, 0)
    ) filter (
      where a.completed_at is not null
        and a.num_questions is not null
        and a.num_questions > 0
    )
  )
  into v_result
  from public.attempts a
  where a.quiz_id = p_quiz_id;

  return v_result;
end;
$$;

revoke execute on function public.quiz_stats(uuid) from public;
grant execute on function public.quiz_stats(uuid) to authenticated, service_role;

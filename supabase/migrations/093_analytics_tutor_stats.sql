-- ============================================================
-- Analytics: tutor_stats(quiz_id | class_id)
-- Volume/count of `tutor_questions` for one scope (a quiz OR a class), plus a
-- flagged list of likely answer-extraction attempts for teacher audit.
--
-- Exactly ONE of `p_quiz_id` / `p_class_id` must be supplied; passing both or
-- neither raises `invalid_args`.
--
-- "Likely answer-extraction attempt" = a tutor question asked while a quiz
-- question was on screen (`question_id IS NOT NULL`), per spec §3.6 / §5. The
-- full flagged rows are returned (most recent first, capped) so the teacher can
-- audit the prompts. Anonymized rows (`student_id IS NULL`) still count toward
-- totals; they simply carry no per-person attribution.
--
-- Owner-checked for the given scope (quiz author / class teacher, not
-- deactivated) against `auth.uid()`.
-- ============================================================

create or replace function public.tutor_stats(
  p_quiz_id uuid default null,
  p_class_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope text;
  v_agg jsonb;
  v_extraction jsonb;
begin
  -- Exactly one scope required (XOR).
  if (p_quiz_id is null) = (p_class_id is null) then
    raise exception 'invalid_args: exactly one of quiz_id/class_id required'
      using errcode = '22023';
  end if;

  if p_quiz_id is not null then
    v_scope := 'quiz';
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
  else
    v_scope := 'class';
    if not public.is_teacher_of_class(p_class_id) then
      raise exception 'not_owner' using errcode = '42501';
    end if;
  end if;

  -- Aggregate counts over the scope.
  select jsonb_build_object(
    'total_questions', count(*),
    'distinct_students', count(distinct tq.student_id)
      filter (where tq.student_id is not null),
    'anonymized_count', count(*) filter (where tq.student_id is null),
    'answer_extraction_count', count(*) filter (where tq.question_id is not null)
  )
  into v_agg
  from public.tutor_questions tq
  where (p_quiz_id is not null and tq.quiz_id = p_quiz_id)
     or (p_class_id is not null and tq.class_id = p_class_id);

  -- Flagged rows (most recent first, capped for a bounded payload).
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'student_id', f.student_id,
        'quiz_id', f.quiz_id,
        'class_id', f.class_id,
        'question_id', f.question_id,
        'attempt_id', f.attempt_id,
        'position_seconds', f.position_seconds,
        'prompt', f.prompt,
        'created_at', f.created_at
      )
      order by f.created_at desc
    ),
    '[]'::jsonb
  )
  into v_extraction
  from (
    select tq.*
    from public.tutor_questions tq
    where tq.question_id is not null
      and (
        (p_quiz_id is not null and tq.quiz_id = p_quiz_id)
        or (p_class_id is not null and tq.class_id = p_class_id)
      )
    order by tq.created_at desc
    limit 200
  ) f;

  return jsonb_build_object('scope', v_scope)
    || v_agg
    || jsonb_build_object('answer_extraction_attempts', v_extraction);
end;
$$;

revoke execute on function public.tutor_stats(uuid, uuid) from public;
grant execute on function public.tutor_stats(uuid, uuid) to authenticated, service_role;

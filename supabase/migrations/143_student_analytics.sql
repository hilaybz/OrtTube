-- ============================================================
-- Analytics: student_analytics(student_id)
--
-- A student is currently reachable only THROUGH a class: `student_quiz_progress`
-- (121) takes a `(class_id, student_id)` pair, so "how is this student doing"
-- had no answer that spanned the classes they belong to. This function is that
-- answer, for one student across every class THE CALLER OWNS.
--
-- Authorization is deliberately two-legged, because "owning a student" is not a
-- thing in this schema:
--   1. the caller must be a non-deactivated teacher (`is_active_teacher`), and
--   2. the student must be a CURRENT member of at least one class the caller
--      owns.
-- Failing either raises the same `not_owner` (42501), so a caller cannot use the
-- error to distinguish "no such student" from "someone else's student" — the
-- same non-oracle reasoning as 136/138. Every row returned is then filtered to
-- the caller's own classes, so a student shared with another teacher never leaks
-- that teacher's class.
--
-- Scoring basis is the student's LATEST completed, gradeable attempt per
-- (class, quiz) — the grade they are shown themselves — and the accompanying
-- `class_average_score` is the same latest-attempt average over that class, so
-- the comparison chart puts the student and their class on one identical basis.
-- `best_score` is kept alongside it because the roster screens (121) report the
-- best, and a student view that silently disagreed with them would look broken.
--
-- Anonymized attempts (`student_id IS NULL`) can never belong to a named
-- student, so they are absent from this student's own rows by construction; they
-- do still count toward `class_average_score` (keyed on the attempt's own id),
-- matching `class_quiz_analytics`.
-- ============================================================

create or replace function public.student_analytics(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_ids  uuid[];
  v_latest_ids uuid[];
  v_quizzes    jsonb;
  v_classes    jsonb;
begin
  if not public.is_active_teacher() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  -- The caller's own classes this student currently belongs to. Empty ⇒ the
  -- student is not the caller's to look at (or does not exist).
  select coalesce(array_agg(c.id), '{}') into v_class_ids
  from public.classes c
  join public.class_members m on m.class_id = c.id
  where c.teacher_id = auth.uid() and m.student_id = p_student_id;

  if array_length(v_class_ids, 1) is null then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  -- One attempt id per (any student, class, quiz) within those classes: the
  -- latest completed gradeable attempt. Used for BOTH this student's scores and
  -- the class averages they are compared against, so the two share one basis.
  select coalesce(array_agg(latest.id), '{}') into v_latest_ids
  from (
    select distinct on (coalesce(a.student_id, a.id), a.class_id, a.quiz_id) a.id
    from public.attempts a
    where a.class_id = any(v_class_ids)
      and a.completed_at is not null
      and a.num_questions is not null
      and a.num_questions > 0
    order by coalesce(a.student_id, a.id), a.class_id, a.quiz_id, a.attempt_no desc
  ) latest;

  -- One row per (class, assigned non-deleted quiz) the student is exposed to.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'class_id',            c.id,
        'class_name',          c.name,
        'quiz_id',             cq.quiz_id,
        'title',               z.title,
        'question_count',      (
          select count(*) from public.questions qs
          where qs.quiz_id = cq.quiz_id and qs.deleted_at is null
        ),
        'published',           cq.published,
        'available_from',      cq.available_from,
        'available_until',     cq.available_until,
        'assigned_at',         cq.assigned_at,
        'max_attempts',        cq.max_attempts,
        'attempt_count',       mine.attempt_count,
        'completed',           mine.completed,
        'last_completed_at',   mine.last_completed_at,
        'latest_score',        latest_mine.score,
        'best_score',          best_mine.score,
        'class_average_score', (
          select avg(a.num_correct::numeric / a.num_questions)
          from public.attempts a
          where a.id = any(v_latest_ids)
            and a.class_id = c.id and a.quiz_id = cq.quiz_id
        ),
        'class_students_completed', (
          select count(*) from public.attempts a
          where a.id = any(v_latest_ids)
            and a.class_id = c.id and a.quiz_id = cq.quiz_id
        ),
        'tutor_question_count', (
          select count(*) from public.tutor_questions tq
          where tq.student_id = p_student_id
            and tq.class_id = c.id and tq.quiz_id = cq.quiz_id
        )
      )
      order by mine.last_completed_at nulls last, cq.assigned_at, cq.quiz_id
    ),
    '[]'::jsonb
  )
  into v_quizzes
  from public.classes c
  join public.class_quizzes cq on cq.class_id = c.id
  join public.quizzes z on z.id = cq.quiz_id and z.deleted_at is null
  cross join lateral (
    select
      count(*) as attempt_count,
      count(*) filter (where a.completed_at is not null) > 0 as completed,
      max(a.completed_at) as last_completed_at
    from public.attempts a
    where a.class_id = c.id and a.quiz_id = cq.quiz_id
      and a.student_id = p_student_id
  ) mine
  left join lateral (
    select (a.num_correct::numeric / a.num_questions) as score
    from public.attempts a
    where a.class_id = c.id and a.quiz_id = cq.quiz_id
      and a.student_id = p_student_id
      and a.completed_at is not null
      and a.num_questions is not null and a.num_questions > 0
    order by a.attempt_no desc
    limit 1
  ) latest_mine on true
  left join lateral (
    select (a.num_correct::numeric / a.num_questions) as score
    from public.attempts a
    where a.class_id = c.id and a.quiz_id = cq.quiz_id
      and a.student_id = p_student_id
      and a.completed_at is not null
      and a.num_questions is not null and a.num_questions > 0
    order by score desc
    limit 1
  ) best_mine on true
  where c.id = any(v_class_ids);

  -- Per-class rollup for this student, alongside the class's own average so the
  -- teacher can see where the student sits inside each class.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'class_id',           c.id,
        'name',               c.name,
        'language',           c.language,
        'member_count',       (
          select count(*) from public.class_members m where m.class_id = c.id
        ),
        'total_assigned',     agg.total_assigned,
        'quizzes_completed',  agg.quizzes_completed,
        'average_score',      agg.average_score,
        'class_average_score', (
          select avg(a.num_correct::numeric / a.num_questions)
          from public.attempts a
          where a.id = any(v_latest_ids) and a.class_id = c.id
        )
      )
      order by c.name, c.id
    ),
    '[]'::jsonb
  )
  into v_classes
  from public.classes c
  cross join lateral (
    select
      count(*) as total_assigned,
      count(*) filter (where mine.completed) as quizzes_completed,
      avg(latest_mine.score) as average_score
    from public.class_quizzes cq
    join public.quizzes z on z.id = cq.quiz_id and z.deleted_at is null
    cross join lateral (
      select count(*) filter (where a.completed_at is not null) > 0 as completed
      from public.attempts a
      where a.class_id = c.id and a.quiz_id = cq.quiz_id
        and a.student_id = p_student_id
    ) mine
    left join lateral (
      select (a.num_correct::numeric / a.num_questions) as score
      from public.attempts a
      where a.class_id = c.id and a.quiz_id = cq.quiz_id
        and a.student_id = p_student_id
        and a.completed_at is not null
        and a.num_questions is not null and a.num_questions > 0
      order by a.attempt_no desc
      limit 1
    ) latest_mine on true
    where cq.class_id = c.id
  ) agg
  where c.id = any(v_class_ids);

  return jsonb_build_object(
    'student_id',   p_student_id,
    'display_name', (select display_name from public.profiles where id = p_student_id),
    'email',        (select email from public.profiles where id = p_student_id),
    'preferred_language',
                    (select preferred_language from public.profiles where id = p_student_id),
    'joined_at',    (
      select min(m.joined_at) from public.class_members m
      where m.student_id = p_student_id and m.class_id = any(v_class_ids)
    ),
    'summary', jsonb_build_object(
      'class_count',      array_length(v_class_ids, 1),
      'total_assigned',   (
        select count(*)
        from public.class_quizzes cq
        join public.quizzes z on z.id = cq.quiz_id and z.deleted_at is null
        where cq.class_id = any(v_class_ids)
      ),
      'quizzes_completed', (
        select count(distinct (a.class_id, a.quiz_id))
        from public.attempts a
        join public.class_quizzes cq
          on cq.class_id = a.class_id and cq.quiz_id = a.quiz_id
        join public.quizzes z on z.id = a.quiz_id and z.deleted_at is null
        where a.class_id = any(v_class_ids)
          and a.student_id = p_student_id
          and a.completed_at is not null
      ),
      'average_score', (
        select avg(a.num_correct::numeric / a.num_questions)
        from public.attempts a
        where a.id = any(v_latest_ids) and a.student_id = p_student_id
      ),
      'peer_average_score', (
        select avg(a.num_correct::numeric / a.num_questions)
        from public.attempts a
        where a.id = any(v_latest_ids)
          and (a.student_id is distinct from p_student_id)
      ),
      'tutor_question_count', (
        select count(*) from public.tutor_questions tq
        where tq.student_id = p_student_id and tq.class_id = any(v_class_ids)
      )
    ),
    'classes', v_classes,
    'quizzes', v_quizzes
  );
end;
$$;

revoke all on function public.student_analytics(uuid) from public;
grant execute on function public.student_analytics(uuid)
  to authenticated, service_role;

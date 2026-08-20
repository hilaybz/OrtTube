-- ============================================================
-- Analytics: class_analytics_overview(class_id)
--
-- The one read behind the analytics hub's CLASS view. `class_stats` (092) can't
-- serve it alone for two reasons:
--
--   1. Its per-quiz average is ATTEMPT-based (every attempt row pooled), while
--      the per-(class, quiz) page (`class_quiz_analytics`, 138) averages each
--      student's LATEST completed attempt. Two screens one click apart would
--      report different averages for the same quiz. This function adopts the
--      latest-attempt basis everywhere, so the class table, its charts and the
--      per-quiz drill-down always agree — and all of them agree with the grade
--      the student is shown on their own results page.
--   2. It returns no allocation lifecycle fields, so "how many quizzes are open
--      / finished" was not answerable. The raw `published` / `available_from` /
--      `available_until` are returned per quiz instead of a SQL state label:
--      `lib/allocationState.ts` is the single derivation of that state in the
--      product, and duplicating the predicate here is what would let the two
--      drift.
--
-- Also returns the two series the class charts need and nothing else could
-- provide: a class-wide score distribution over every (student, quiz) latest
-- completed attempt, and a completions-per-day series for the recent window.
--
-- Scope decisions (mirror `class_stats` / `class_roster_progress`):
--   * Quizzes — assigned AND non-deleted; a soft-deleted quiz drops out.
--   * Members — CURRENT `class_members` only, as the completion denominator.
--   * Anonymized attempts (`student_id IS NULL`) keep their own row via
--     `coalesce(student_id, id)`, exactly as 138 does, so a departed student's
--     result still counts toward the class average instead of collapsing every
--     anonymized attempt into one.
--
-- SECURITY DEFINER with the standard owner assertion (`is_teacher_of_class` →
-- `not_owner`, SQLSTATE 42501). Call with the signed-in teacher's client.
-- ============================================================

-- Days of completion history the chart covers. A class's activity is the school
-- term, not all of history, and an unbounded series would grow without limit.
create or replace function public.class_analytics_overview(p_class_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completion_window_days constant int := 90;
  v_class        public.classes;
  v_member_count int;
  v_latest_ids   uuid[];
  v_distribution jsonb;
  v_completions  jsonb;
  v_quizzes      jsonb;
begin
  if not public.is_teacher_of_class(p_class_id) then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  select * into v_class from public.classes where id = p_class_id;

  select count(*) into v_member_count
  from public.class_members where class_id = p_class_id;

  -- One attempt id per (student, quiz): that student's LATEST completed,
  -- gradeable attempt on this class's assignment of the quiz. Every average and
  -- distribution below is `where id = any(v_latest_ids)`, so they cannot drift
  -- apart from each other.
  select coalesce(array_agg(latest.id), '{}') into v_latest_ids
  from (
    select distinct on (coalesce(a.student_id, a.id), a.quiz_id) a.id
    from public.attempts a
    join public.class_quizzes cq
      on cq.class_id = a.class_id and cq.quiz_id = a.quiz_id
    join public.quizzes z on z.id = a.quiz_id and z.deleted_at is null
    where a.class_id = p_class_id
      and a.completed_at is not null
      and a.num_questions is not null
      and a.num_questions > 0
    order by coalesce(a.student_id, a.id), a.quiz_id, a.attempt_no desc
  ) latest;

  -- Five 20%-wide bands over every counted (student, quiz) result, always all
  -- five present so the chart never backfills gaps. `least(..., 5)` folds a
  -- perfect 1.0 into the top band rather than a phantom sixth.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'bucket_min', (n - 1) * 0.2,
        'bucket_max', n * 0.2,
        'count',      coalesce(counts.cnt, 0)
      ) order by n
    ),
    '[]'::jsonb
  )
  into v_distribution
  from generate_series(1, 5) n
  left join (
    select
      least(width_bucket(num_correct::numeric / num_questions, 0, 1, 5), 5) as bucket,
      count(*) as cnt
    from public.attempts
    where id = any(v_latest_ids)
    group by bucket
  ) counts on counts.bucket = n;

  -- Completions per day over the recent window. Only days with activity are
  -- returned; the chart supplies the empty days, which keeps the payload
  -- proportional to real activity rather than to the window length.
  select coalesce(
    jsonb_agg(
      jsonb_build_object('day', d.day, 'count', d.cnt) order by d.day
    ),
    '[]'::jsonb
  )
  into v_completions
  from (
    select (a.completed_at at time zone 'UTC')::date as day, count(*) as cnt
    from public.attempts a
    join public.class_quizzes cq
      on cq.class_id = a.class_id and cq.quiz_id = a.quiz_id
    join public.quizzes z on z.id = a.quiz_id and z.deleted_at is null
    where a.class_id = p_class_id
      and a.completed_at is not null
      and a.completed_at >= now() - make_interval(days => v_completion_window_days)
    group by 1
  ) d;

  -- Per assigned, non-deleted quiz. `students_completed` counts the students
  -- behind the average (gradeable latest attempts); `members_completed` is the
  -- roster-based figure the UI renders as `12/28`, so it deliberately excludes
  -- anonymized/departed students — the two are not interchangeable.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'quiz_id',            cq.quiz_id,
        'title',              z.title,
        'base_language',      z.base_language,
        'question_count',     (
          select count(*) from public.questions qs
          where qs.quiz_id = cq.quiz_id and qs.deleted_at is null
        ),
        'tutor_mode',         cq.tutor_mode,
        'max_attempts',       cq.max_attempts,
        'published',          cq.published,
        'available_from',     cq.available_from,
        'available_until',    cq.available_until,
        'assigned_at',        cq.assigned_at,
        'member_count',       v_member_count,
        'members_completed',  (
          select count(distinct a.student_id)
          from public.attempts a
          join public.class_members m
            on m.class_id = p_class_id and m.student_id = a.student_id
          where a.class_id = p_class_id and a.quiz_id = cq.quiz_id
            and a.completed_at is not null
        ),
        'students_completed', (
          select count(*) from public.attempts a
          where a.id = any(v_latest_ids) and a.quiz_id = cq.quiz_id
        ),
        'average_score',      (
          select avg(a.num_correct::numeric / a.num_questions)
          from public.attempts a
          where a.id = any(v_latest_ids) and a.quiz_id = cq.quiz_id
        ),
        'tutor_question_count', (
          select count(*) from public.tutor_questions tq
          where tq.class_id = p_class_id and tq.quiz_id = cq.quiz_id
        )
      )
      order by cq.assigned_at desc, cq.quiz_id
    ),
    '[]'::jsonb
  )
  into v_quizzes
  from public.class_quizzes cq
  join public.quizzes z on z.id = cq.quiz_id
  where cq.class_id = p_class_id and z.deleted_at is null;

  return jsonb_build_object(
    'class_id',           p_class_id,
    'name',               v_class.name,
    'language',           v_class.language,
    'member_count',       v_member_count,
    'quiz_count',         jsonb_array_length(v_quizzes),
    'students_completed', (
      select count(distinct coalesce(a.student_id, a.id))
      from public.attempts a where a.id = any(v_latest_ids)
    ),
    'average_score',      (
      select avg(num_correct::numeric / num_questions)
      from public.attempts where id = any(v_latest_ids)
    ),
    'tutor_question_count', (
      select count(*) from public.tutor_questions where class_id = p_class_id
    ),
    'score_distribution', v_distribution,
    'completions',        v_completions,
    'quizzes',            v_quizzes
  );
end;
$$;

revoke all on function public.class_analytics_overview(uuid) from public;
grant execute on function public.class_analytics_overview(uuid)
  to authenticated, service_role;

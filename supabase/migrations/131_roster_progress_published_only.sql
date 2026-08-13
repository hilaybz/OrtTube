-- ============================================================
-- Fix: roster-progress denominators counted draft/scheduled allocations
--
-- class_roster_progress / student_quiz_progress (121_analytics_roster_progress.sql)
-- treat every non-deleted class_quizzes row as "assigned" for the purposes of
-- `total_assigned` / `possible_completions` and the per-student quiz list —
-- predating 2A.1's `published` flag and 2A.2's scheduling window, both of
-- which can now make a class_quizzes row exist while no student has ever
-- been able to see it.
--
-- Concrete effect before this fix: a class with 2 live quizzes and 3 drafts
-- (reachable via bulk-assign with "פרסום מיידי" unchecked) showed every
-- student's progress as "2 of 5" instead of "2 of 2", and the class summary's
-- `possible_completions` (member_count * total_assigned) was correspondingly
-- inflated — the teacher's headline numbers silently wrong the moment a
-- draft/scheduled allocation exists.
--
-- Fix: count a quiz toward these denominators once it has been published AND
-- its window (if any) has opened — `cq.published and (cq.available_from is
-- null or cq.available_from <= now())`. Deliberately NOT `_allocation_is_live`:
-- a quiz whose window has since CLOSED should still count (a student who
-- completed it before it closed earned that credit, and the teacher should
-- still see it in the roster), only a draft or not-yet-open scheduled
-- allocation should not.
-- ============================================================

create or replace function public.class_roster_progress(p_class_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_count    int;
  v_total_assigned  int;
  v_completed_total int;
  v_avg_score       numeric;
  v_members         jsonb;
begin
  -- Owner check: caller must own the class and not be deactivated.
  if not public.is_teacher_of_class(p_class_id) then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  select count(*) into v_member_count
  from public.class_members where class_id = p_class_id;

  -- Assigned, non-deleted, published-and-started quizzes — the per-member
  -- denominator. A draft or not-yet-open scheduled allocation never counts;
  -- one that was live and has since closed still does.
  select count(*) into v_total_assigned
  from public.class_quizzes cq
  join public.quizzes z on z.id = cq.quiz_id
  where cq.class_id = p_class_id and z.deleted_at is null
    and cq.published
    and (cq.available_from is null or cq.available_from <= now());

  -- Class-level rollup: total completions (member × quiz pairs the member
  -- completed) and the mean best score over all gradeable completed pairs.
  select
    coalesce(count(*) filter (where att.completed), 0),
    avg(best.score)
  into v_completed_total, v_avg_score
  from public.class_members m
  cross join lateral (
    select cq.quiz_id
    from public.class_quizzes cq
    join public.quizzes z on z.id = cq.quiz_id
    where cq.class_id = p_class_id and z.deleted_at is null
      and cq.published
      and (cq.available_from is null or cq.available_from <= now())
  ) aq
  cross join lateral (
    select count(*) filter (where a.completed_at is not null) > 0 as completed
    from public.attempts a
    where a.class_id = p_class_id and a.quiz_id = aq.quiz_id
      and a.student_id = m.student_id
  ) att
  left join lateral (
    select (a2.num_correct::numeric / a2.num_questions) as score
    from public.attempts a2
    where a2.class_id = p_class_id and a2.quiz_id = aq.quiz_id
      and a2.student_id = m.student_id
      and a2.completed_at is not null
      and a2.num_questions is not null and a2.num_questions > 0
    order by score desc
    limit 1
  ) best on true
  where m.class_id = p_class_id;

  -- Per-member object, one per current member, sorted by name then id.
  select coalesce(
    jsonb_agg(r.member_obj order by r.display_name nulls last, r.student_id),
    '[]'::jsonb
  )
  into v_members
  from (
    select
      m.student_id,
      p.display_name,
      (
        select jsonb_build_object(
          'student_id', m.student_id,
          'display_name', p.display_name,
          'email', p.email,
          'total_assigned', v_total_assigned,
          'quizzes_completed', coalesce(count(*) filter (where att.completed), 0),
          'average_best_score', avg(best.score),
          'quizzes', coalesce(
            jsonb_agg(
              jsonb_build_object(
                'quiz_id', cq.quiz_id,
                'title', z.title,
                'completed', att.completed,
                'attempt_count', att.attempt_count,
                'best_num_correct', best.num_correct,
                'best_num_questions', best.num_questions,
                'best_score', best.score
              )
              order by cq.assigned_at, cq.quiz_id
            ),
            '[]'::jsonb
          )
        )
        from public.class_quizzes cq
        join public.quizzes z on z.id = cq.quiz_id
        cross join lateral (
          select
            count(*) as attempt_count,
            count(*) filter (where a.completed_at is not null) > 0 as completed
          from public.attempts a
          where a.class_id = p_class_id and a.quiz_id = cq.quiz_id
            and a.student_id = m.student_id
        ) att
        left join lateral (
          select a2.num_correct, a2.num_questions,
                 (a2.num_correct::numeric / a2.num_questions) as score
          from public.attempts a2
          where a2.class_id = p_class_id and a2.quiz_id = cq.quiz_id
            and a2.student_id = m.student_id
            and a2.completed_at is not null
            and a2.num_questions is not null and a2.num_questions > 0
          order by score desc
          limit 1
        ) best on true
        where cq.class_id = p_class_id and z.deleted_at is null
          and cq.published
          and (cq.available_from is null or cq.available_from <= now())
      ) as member_obj
    from public.class_members m
    join public.profiles p on p.id = m.student_id
    where m.class_id = p_class_id
  ) r;

  return jsonb_build_object(
    'class_id', p_class_id,
    'summary', jsonb_build_object(
      'member_count', v_member_count,
      'total_assigned', v_total_assigned,
      'possible_completions', v_member_count * v_total_assigned,
      'quizzes_completed_total', v_completed_total,
      'average_best_score', v_avg_score
    ),
    'members', v_members
  );
end;
$$;

create or replace function public.student_quiz_progress(
  p_class_id   uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  -- Owner check: caller must own the class and not be deactivated.
  if not public.is_teacher_of_class(p_class_id) then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  -- Membership check: the student must be a CURRENT member of this class.
  -- Without it, a teacher could pass any UUID and read that user's
  -- name/email cross-school, since SECURITY DEFINER bypasses profiles RLS.
  if not exists (
    select 1 from public.class_members
    where class_id = p_class_id and student_id = p_student_id
  ) then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'class_id', p_class_id,
    'student_id', p_student_id,
    'display_name', (select display_name from public.profiles where id = p_student_id),
    'email', (select email from public.profiles where id = p_student_id),
    'quizzes', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'quiz_id', cq.quiz_id,
            'title', z.title,
            'completed', att.completed,
            'attempt_count', att.attempt_count,
            'best_score', best.score,
            'attempts', att.attempts
          )
          order by cq.assigned_at, cq.quiz_id
        )
        from public.class_quizzes cq
        join public.quizzes z on z.id = cq.quiz_id
        cross join lateral (
          select
            count(*) as attempt_count,
            count(*) filter (where a.completed_at is not null) > 0 as completed,
            coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'attempt_id', a.id,
                  'attempt_no', a.attempt_no,
                  'started_at', a.started_at,
                  'completed_at', a.completed_at,
                  'num_correct', a.num_correct,
                  'num_questions', a.num_questions,
                  'score', case
                    when a.completed_at is not null
                      and a.num_questions is not null and a.num_questions > 0
                    then (a.num_correct::numeric / a.num_questions)
                    else null
                  end
                )
                order by a.attempt_no
              ) filter (where a.id is not null),
              '[]'::jsonb
            ) as attempts
          from public.attempts a
          where a.class_id = p_class_id and a.quiz_id = cq.quiz_id
            and a.student_id = p_student_id
        ) att
        left join lateral (
          select (a2.num_correct::numeric / a2.num_questions) as score
          from public.attempts a2
          where a2.class_id = p_class_id and a2.quiz_id = cq.quiz_id
            and a2.student_id = p_student_id
            and a2.completed_at is not null
            and a2.num_questions is not null and a2.num_questions > 0
          order by score desc
          limit 1
        ) best on true
        where cq.class_id = p_class_id and z.deleted_at is null
          and cq.published
          and (cq.available_from is null or cq.available_from <= now())
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.class_roster_progress(uuid) from public;
grant execute on function public.class_roster_progress(uuid) to authenticated, service_role;

revoke execute on function public.student_quiz_progress(uuid, uuid) from public;
grant execute on function public.student_quiz_progress(uuid, uuid) to authenticated, service_role;

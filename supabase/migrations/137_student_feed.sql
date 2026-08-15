-- ============================================================
-- list_student_feed() — replaces list_assigned_for_student()
--
-- The student feed splits into two sections in the UI: quizzes not yet
-- attempted (including one the student started but hasn't finished) and
-- finished ones (completed, or "missed" — a window that closed before the
-- student ever started it). Rather than the old class-tabbed, per-quiz-
-- fan-out shape (list_assigned_for_student + N x list_my_attempts_for_quiz,
-- one round trip per quiz), this returns ONE flat array with everything
-- each card needs already joined in: the assigning teacher's name, and each
-- quiz's attempt/grade state.
--
-- Assigning teacher = classes.teacher_id, NOT quizzes.author_id — a shared
-- quiz can be assigned by any same-school teacher, not just its author
-- (assign_quiz_to_class, 051_class_assignment_rpcs.sql). Join pattern
-- mirrors list_shared_quizzes (080) / get_quiz_for_preview (134):
-- left join profiles ... display_name.
--
-- Visibility (the WHERE clause): a published allocation is included if it's
-- currently live (_allocation_is_live, 128) OR if it has already closed
-- (available_until in the past) — the second half is new, and is what fixes
-- issue #69's student-side gap: today, the instant a window closes, the
-- allocation looks exactly like a draft or an unassigned quiz everywhere,
-- so a quiz the student actually completed silently vanishes from their
-- feed along with everything else. A draft (published = false) or a
-- not-yet-open allocation (available_from in the future) still shows
-- nothing, same as today.
--
-- status is derived, in this priority order:
--   in_progress — an unfinished attempt exists (the resume target)
--   completed   — no unfinished attempt, but at least one completed one
--   missed      — no attempt at all, ever, and the window has since closed
--   not_started — no attempt, and either still open or open-ended
-- A window that closes while a student is mid-attempt force-completes that
-- attempt (submit_answer/complete_attempt's hard cutoff, see
-- 129_attempt_window_finalization.sql) before this RPC would ever observe
-- it, so that case naturally lands on `completed`, never `missed`.
--
-- Grade shown for `completed` is always the LATEST completed attempt (by
-- attempt_no), never the best of several — the one consistent convention
-- for multi-attempt state everywhere else in this codebase
-- (list_my_attempts_for_quiz, findLatestCompletedAttempt in lib/attempts.ts).
-- ============================================================

drop function if exists public.list_assigned_for_student();

create or replace function public.list_student_feed()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid := auth.uid();
begin
  if v_student is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'class_id',            c.id,
        'class_name',          c.name,
        'teacher_name',        tp.display_name,
        'quiz_id',             q.id,
        'title',               q.title,
        'youtube_video_id',    v.youtube_video_id,
        'video_title',         v.title,
        'max_attempts',        cq.max_attempts,
        'available_until',     cq.available_until,
        'assigned_at',         cq.assigned_at,
        'is_live',             public._allocation_is_live(cq),
        'status', case
                    when a_resume.id is not null then 'in_progress'
                    when a_stats.completed_count > 0 then 'completed'
                    when cq.available_until is not null and cq.available_until <= now() then 'missed'
                    else 'not_started'
                  end,
        'attempts_left', case
                            when cq.max_attempts is null then null
                            else greatest(cq.max_attempts - a_stats.completed_count, 0)
                          end,
        'last_num_correct',   a_last.num_correct,
        'last_num_questions', a_last.num_questions,
        'last_completed_at',  a_last.completed_at,
        'resume_attempt_id',  a_resume.id
      )
      order by cq.assigned_at desc
    )
    from public.class_members m
    join public.classes       c  on c.id = m.class_id
    join public.class_quizzes cq on cq.class_id = c.id
    join public.quizzes       q  on q.id = cq.quiz_id and q.deleted_at is null
    join public.videos        v  on v.id = q.video_id
    left join public.profiles tp on tp.id = c.teacher_id
    left join lateral (
      select count(*) filter (where a.completed_at is not null) as completed_count
      from public.attempts a
      where a.student_id = v_student and a.class_id = c.id and a.quiz_id = q.id
    ) a_stats on true
    left join lateral (
      select a.id
      from public.attempts a
      where a.student_id = v_student and a.class_id = c.id and a.quiz_id = q.id
        and a.completed_at is null
      order by a.attempt_no desc
      limit 1
    ) a_resume on true
    left join lateral (
      select a.num_correct, a.num_questions, a.completed_at
      from public.attempts a
      where a.student_id = v_student and a.class_id = c.id and a.quiz_id = q.id
        and a.completed_at is not null
      order by a.attempt_no desc
      limit 1
    ) a_last on true
    where m.student_id = v_student
      and cq.published = true
      and (
        public._allocation_is_live(cq)
        or (cq.available_until is not null and cq.available_until <= now())
      )
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_student_feed() from public;
grant execute on function public.list_student_feed() to authenticated, service_role;

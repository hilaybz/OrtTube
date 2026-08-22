-- ============================================================
-- Analytics: quiz_analytics_overview(quiz_id)
--
-- A quiz had no cross-class rollup. `quiz_stats` (090) gives three attempt-based
-- numbers and no breakdown; `question_stats` (091) gives per-question detail but
-- pools EVERY attempt including retakes; `class_quiz_analytics` (138) is one
-- class at a time. None answers "how is this quiz doing, everywhere it runs" —
-- which classes it is assigned to, how each of them did, and which questions
-- students get wrong most often.
--
-- Author-scoped, matching the quiz branch of `tutor_prompts_in_scope` (122):
-- the caller must be the quiz's author and a non-deactivated teacher, else
-- `not_owner` (42501). Consequently the per-class rows may include a class owned
-- by ANOTHER same-school teacher — a `shared` quiz can be assigned by any
-- same-school teacher (`assign_quiz_to_class`), and the author already sees
-- those attempts pooled in `quiz_stats`/`question_stats`. Naming the class is
-- what makes that pooled number actionable rather than mysterious.
--
-- Scoring basis is each student's LATEST completed gradeable attempt per
-- (class, quiz) — the same basis as 138 and as the grade the student is shown —
-- so the quiz average equals the roster-weighted mean of its per-class averages
-- and never disagrees with the class pages one click away. Question prompts are
-- read in the quiz's BASE language: this is the author's own view of their own
-- quiz, not a class delivery.
--
-- `correct_pct` per question is what the "most-often-wrong questions" list sorts
-- on; it is returned unsorted (in question order) because the UI also renders
-- the questions in order, and sorting twice server-side would just be a second
-- copy of the same array.
-- ============================================================

create or replace function public.quiz_analytics_overview(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz         public.quizzes;
  v_video        public.videos;
  v_latest_ids   uuid[];
  v_distribution jsonb;
  v_classes      jsonb;
  v_questions    jsonb;
begin
  -- Author gate: same predicate as tutor_prompts_in_scope's quiz branch.
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

  select * into v_quiz from public.quizzes where id = p_quiz_id;
  select * into v_video from public.videos where id = v_quiz.video_id;

  -- One attempt id per (student, class): their latest completed gradeable
  -- attempt on this quiz. Anonymized attempts keep their own row via
  -- `coalesce(student_id, id)`, as in 138.
  select coalesce(array_agg(latest.id), '{}') into v_latest_ids
  from (
    select distinct on (coalesce(a.student_id, a.id), a.class_id) a.id
    from public.attempts a
    where a.quiz_id = p_quiz_id
      and a.completed_at is not null
      and a.num_questions is not null
      and a.num_questions > 0
    order by coalesce(a.student_id, a.id), a.class_id, a.attempt_no desc
  ) latest;

  -- Five 20%-wide bands, always all five present; `least(..., 5)` folds a
  -- perfect score into the top band rather than a phantom sixth.
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

  -- Every class this quiz is assigned to, with that class's own numbers.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'class_id',           c.id,
        'name',               c.name,
        'language',           c.language,
        'teacher_id',         c.teacher_id,
        'teacher_name',       tp.display_name,
        'is_own_class',       (c.teacher_id = auth.uid()),
        'member_count',       (
          select count(*) from public.class_members m where m.class_id = c.id
        ),
        'published',          cq.published,
        'available_from',     cq.available_from,
        'available_until',    cq.available_until,
        'assigned_at',        cq.assigned_at,
        'max_attempts',       cq.max_attempts,
        'tutor_mode',         cq.tutor_mode,
        'students_completed', (
          select count(*) from public.attempts a
          where a.id = any(v_latest_ids) and a.class_id = c.id
        ),
        'attempt_count',      (
          select count(*) from public.attempts a
          where a.quiz_id = p_quiz_id and a.class_id = c.id
        ),
        'average_score',      (
          select avg(a.num_correct::numeric / a.num_questions)
          from public.attempts a
          where a.id = any(v_latest_ids) and a.class_id = c.id
        ),
        'tutor_question_count', (
          select count(*) from public.tutor_questions tq
          where tq.quiz_id = p_quiz_id and tq.class_id = c.id
        )
      )
      order by cq.assigned_at desc, c.id
    ),
    '[]'::jsonb
  )
  into v_classes
  from public.class_quizzes cq
  join public.classes c on c.id = cq.class_id
  left join public.profiles tp on tp.id = c.teacher_id
  where cq.quiz_id = p_quiz_id;

  -- Per-question difficulty over the counted attempts. Soft-deleted questions
  -- are reported (flagged), not hidden — the "keep, don't hide" precedent from
  -- `question_stats`, so a since-edited quiz's history still reads.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'question_id',      q.id,
        'order_index',      q.order_index,
        'position_seconds', q.position_seconds,
        'kind',             q.kind,
        'deleted',          (q.deleted_at is not null),
        'prompt',           qt.prompt,
        'answered_count',   (
          select count(*) from public.answers a
          where a.question_id = q.id and a.attempt_id = any(v_latest_ids)
        ),
        'correct_count',    (
          select count(*) from public.answers a
          where a.question_id = q.id and a.attempt_id = any(v_latest_ids)
            and a.was_correct
        ),
        'correct_pct',      (
          select case when count(*) = 0 then null
                      else count(*) filter (where a.was_correct)::numeric / count(*)
                 end
          from public.answers a
          where a.question_id = q.id and a.attempt_id = any(v_latest_ids)
        ),
        'tutor_question_count', (
          select count(*) from public.tutor_questions tq
          where tq.question_id = q.id
        )
      )
      order by q.order_index, q.id
    ),
    '[]'::jsonb
  )
  into v_questions
  from public.questions q
  left join public.question_translations qt
    on qt.question_id = q.id and qt.language = v_quiz.base_language
  where q.quiz_id = p_quiz_id;

  return jsonb_build_object(
    'quiz_id',       p_quiz_id,
    'title',         v_quiz.title,
    'base_language', v_quiz.base_language,
    'visibility',    v_quiz.visibility,
    'created_at',    v_quiz.created_at,
    'video', jsonb_build_object(
      'video_id',         v_video.id,
      'youtube_video_id', v_video.youtube_video_id,
      'title',            v_video.title,
      'channel_name',     v_video.channel_name,
      'duration_seconds', v_video.duration_seconds
    ),
    'summary', jsonb_build_object(
      'question_count', (
        select count(*) from public.questions qs
        where qs.quiz_id = p_quiz_id and qs.deleted_at is null
      ),
      'class_count',    jsonb_array_length(v_classes),
      'member_count',   (
        select count(*)
        from public.class_members m
        where m.class_id in (
          select cq.class_id from public.class_quizzes cq where cq.quiz_id = p_quiz_id
        )
      ),
      'students_completed', coalesce(array_length(v_latest_ids, 1), 0),
      'attempt_count',      (
        select count(*) from public.attempts where quiz_id = p_quiz_id
      ),
      'completion_count',   (
        select count(*) from public.attempts
        where quiz_id = p_quiz_id and completed_at is not null
      ),
      'average_score',      (
        select avg(num_correct::numeric / num_questions)
        from public.attempts where id = any(v_latest_ids)
      ),
      'tutor_question_count', (
        select count(*) from public.tutor_questions where quiz_id = p_quiz_id
      )
    ),
    'score_distribution', v_distribution,
    'classes',            v_classes,
    'questions',          v_questions
  );
end;
$$;

revoke all on function public.quiz_analytics_overview(uuid) from public;
grant execute on function public.quiz_analytics_overview(uuid)
  to authenticated, service_role;

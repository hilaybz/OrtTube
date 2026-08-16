-- ============================================================
-- Class-scoped quiz analytics + ownership on the class quiz list.
--
-- 1. list_class_quizzes gains author_id/author_name/is_own so the class page
--    can tell "your own quiz" (→ editor) from "an assigned shared quiz you
--    didn't author" (→ read-only preview). Same precedent as list_shared_quizzes
--    (133_shared_quiz_channel_name.sql): is_own is a plain (author_id =
--    auth.uid()) comparison, author_name via a LEFT join so a missing profile
--    yields null instead of dropping the row. Returns bare jsonb, so this is a
--    plain create-or-replace — no drop needed.
--
-- 2. class_quiz_analytics(class_id, quiz_id): the per-(class, quiz) analytic
--    class_stats/question_stats don't provide — class_stats is class-wide
--    (all quizzes), question_stats is quiz-wide (all classes, and would pool
--    together every class that ever ran the quiz). This is the first RPC to
--    take both a class_id and a quiz_id together for one scoped answer.
--
--    Score basis: the LATEST completed attempt per student, not best and not
--    every attempt — matches the grade a student is actually shown
--    (findLatestCompletedAttempt in lib/attempts.ts), so a teacher's analytics
--    page and a student's own result never disagree. The candidate set is
--    narrowed to a plain uuid[] of attempt ids (v_latest_ids) rather than a
--    temp table, so every downstream count/aggregate is just
--    `where attempt_id = any(v_latest_ids)`. `coalesce(student_id, id)` keys
--    anonymized attempts (student_id is null) on their own row instead of
--    collapsing every anonymized student into one — the attempts table still
--    counts them (docs/data-model.md), just not merged together.
--
--    Guard order deliberately checks class ownership BEFORE the assignment
--    existence check, so a non-owner can't use not_owner vs not_assigned as an
--    existence oracle for another teacher's class-quiz assignment — the same
--    ordering fix as 136_preview_gate_ordering.sql.
-- ============================================================

create or replace function public.list_class_quizzes(p_class_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert_class_owner(p_class_id);
  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'quiz_id',          q.id,
               'title',            q.title,
               'base_language',    q.base_language,
               'visibility',       q.visibility,
               'video_id',         v.id,
               'youtube_video_id', v.youtube_video_id,
               'video_title',      v.title,
               'tutor_mode',       cq.tutor_mode,
               'max_attempts',     cq.max_attempts,
               'published',        cq.published,
               'available_from',   cq.available_from,
               'available_until',  cq.available_until,
               'assigned_at',      cq.assigned_at,
               'question_count',   (
                 select count(*) from public.questions qs
                 where qs.quiz_id = q.id and qs.deleted_at is null
               ),
               'author_id',        q.author_id,
               'author_name',      p.display_name,
               'is_own',           (q.author_id = auth.uid())
             ) order by cq.assigned_at desc
           )
    from public.class_quizzes cq
    join public.quizzes q on q.id = cq.quiz_id
    join public.videos  v on v.id = q.video_id
    left join public.profiles p on p.id = q.author_id
    where cq.class_id = p_class_id
      and q.deleted_at is null
  ), '[]'::jsonb);
end;
$$;

create or replace function public.class_quiz_analytics(
  p_class_id uuid,
  p_quiz_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_lang    text;
  v_base_lang     text;
  v_resolved_lang text;
  v_title         text;
  v_member_count  int;
  v_latest_ids    uuid[];
  v_students_completed int;
  v_average_score numeric;
  v_distribution  jsonb;
  v_questions     jsonb;
begin
  -- Access gate first: a non-owner must get the same not_owner error whether
  -- or not the quiz is actually assigned to this class.
  if not public.is_teacher_of_class(p_class_id) then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.class_quizzes
    where class_id = p_class_id and quiz_id = p_quiz_id
  ) then
    raise exception 'not_assigned' using errcode = 'P0002';
  end if;

  select title, base_language into v_title, v_base_lang
  from public.quizzes where id = p_quiz_id;

  select language into v_class_lang from public.classes where id = p_class_id;
  v_resolved_lang := coalesce(
    case when v_class_lang in ('he', 'ar', 'en') then v_class_lang end,
    v_base_lang
  );

  select count(*) into v_member_count
  from public.class_members where class_id = p_class_id;

  -- One attempt id per student: their latest completed, gradeable attempt on
  -- this (class, quiz). Anonymized attempts (student_id is null) are kept
  -- distinct by keying on the attempt's own id instead of student_id.
  select array_agg(latest.id) into v_latest_ids
  from (
    select distinct on (coalesce(a.student_id, a.id)) a.id, a.num_correct, a.num_questions
    from public.attempts a
    where a.class_id = p_class_id
      and a.quiz_id = p_quiz_id
      and a.completed_at is not null
      and a.num_questions is not null
      and a.num_questions > 0
    order by coalesce(a.student_id, a.id), a.attempt_no desc
  ) latest;
  v_latest_ids := coalesce(v_latest_ids, '{}');

  select count(*), avg(num_correct::numeric / num_questions)
  into v_students_completed, v_average_score
  from public.attempts
  where id = any(v_latest_ids);

  -- Five 20%-wide score buckets, always all five present (0 counts included)
  -- so the UI never has to backfill gaps. `least(..., 5)` folds a perfect 1.0
  -- score (which width_bucket would otherwise place in a phantom 6th bucket)
  -- into the top one.
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'question_id',      q.id,
        'order_index',      q.order_index,
        'position_seconds', q.position_seconds,
        'kind',             q.kind,
        'deleted',          (q.deleted_at is not null),
        'prompt',           coalesce(qt_r.prompt, qt_b.prompt),
        'answered_count',   (
          select count(*) from public.answers a
          where a.question_id = q.id and a.attempt_id = any(v_latest_ids)
        ),
        'correct_count',    (
          select count(*) from public.answers a
          where a.question_id = q.id and a.attempt_id = any(v_latest_ids)
            and a.was_correct
        ),
        'correct_pct', (
          select case when count(*) = 0 then null
                      else count(*) filter (where a.was_correct)::numeric / count(*)
                 end
          from public.answers a
          where a.question_id = q.id and a.attempt_id = any(v_latest_ids)
        ),
        'options', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'option_id',   o.id,
                'order_index', o.order_index,
                'text',        coalesce(otr.text, otb.text),
                'is_correct',  o.is_correct,
                'deleted',     (o.deleted_at is not null),
                'selection_count', (
                  select count(*)
                  from public.answer_selections sel
                  join public.answers a2 on a2.id = sel.answer_id
                  where sel.option_id = o.id
                    and a2.question_id = q.id
                    and a2.attempt_id = any(v_latest_ids)
                )
              )
              order by o.order_index, o.id
            ),
            '[]'::jsonb
          )
          from public.question_options o
          left join public.option_translations otr
            on otr.option_id = o.id and otr.language = v_resolved_lang
          left join public.option_translations otb
            on otb.option_id = o.id and otb.language = v_base_lang
          where o.question_id = q.id
        )
      )
      order by q.order_index, q.id
    ),
    '[]'::jsonb
  )
  into v_questions
  from public.questions q
  left join public.question_translations qt_r
    on qt_r.question_id = q.id and qt_r.language = v_resolved_lang
  left join public.question_translations qt_b
    on qt_b.question_id = q.id and qt_b.language = v_base_lang
  where q.quiz_id = p_quiz_id;

  return jsonb_build_object(
    'class_id',           p_class_id,
    'quiz_id',            p_quiz_id,
    'title',              v_title,
    'question_count',     jsonb_array_length(v_questions),
    'member_count',       v_member_count,
    'students_completed', v_students_completed,
    'attempt_count',      (
      select count(*) from public.attempts
      where class_id = p_class_id and quiz_id = p_quiz_id
    ),
    'completion_count',   (
      select count(*) from public.attempts
      where class_id = p_class_id and quiz_id = p_quiz_id
        and completed_at is not null
    ),
    'average_score',      v_average_score,
    'score_distribution', v_distribution,
    'questions',          v_questions
  );
end;
$$;

create index if not exists idx_attempts_class_quiz on public.attempts(class_id, quiz_id);

revoke all on function public.class_quiz_analytics(uuid, uuid) from public;
grant execute on function public.class_quiz_analytics(uuid, uuid) to authenticated, service_role;

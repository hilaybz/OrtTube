-- ============================================================
-- Analytics: tutor_questions_page(student_id, quiz_id, class_id, limit, offset)
--
-- The teacher-facing log of what students actually asked OrtAI, paged. Neither
-- existing reader can serve the student and quiz analytics views:
--   * `tutor_stats` (093) returns only the FLAGGED subset (asked while a question
--     was on screen) for audit, not the ordinary questions.
--   * `tutor_prompts_in_scope` (122) returns bare prompt text for ONE scope, up
--     to a hard 500-row cap, with no attribution and no paging — it exists to
--     feed a model, and it still does (the AI summary reads it).
-- This one is the human-readable log: attributed, filterable by quiz/class, and
-- paged with a total so an unbounded log stays a bounded payload.
--
-- Scoping is a conjunction of whatever is supplied, and EVERY supplied scope
-- must be one the caller owns — there is no scope that authorizes another. At
-- least one is required (`invalid_args`, mirroring `tutor_stats`).
--   * student — the caller must be an active teacher with this student in one of
--               their classes, and rows are additionally confined to the
--               caller's OWN classes: a teacher owns classes, never students, so
--               a student shared with another teacher never leaks that
--               teacher's class.
--   * quiz    — the caller must be the quiz's author; rows span every class the
--               quiz runs in, matching `tutor_prompts_in_scope`'s quiz branch and
--               the cross-class basis of `quiz_analytics_overview`.
--   * class   — the caller must own the class (`is_teacher_of_class`).
--
-- Anonymized rows (`student_id IS NULL`) are included in the class/quiz scopes
-- with a null student — the interaction happened and still informs teaching; the
-- student scope cannot match them, since a named student is what it filters on.
--
-- The whole payload is built in ONE statement over a `scope` CTE, so the total,
-- the page and both filter lists are provably describing the same row set rather
-- than four copies of a predicate that could drift.
--
-- `quiz_filters` / `class_filters` are the distinct quizzes and classes present
-- in the UNPAGED scope — what the view's filter dropdown offers, so it can only
-- ever offer values that exist, without a second round trip per page.
-- ============================================================

create or replace function public.tutor_questions_page(
  p_student_id uuid default null,
  p_quiz_id    uuid default null,
  p_class_id   uuid default null,
  p_limit      int  default 10,
  p_offset     int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit     int;
  v_offset    int;
  v_class_ids uuid[] := null;   -- null = the student leg imposes no constraint
  v_result    jsonb;
begin
  if p_student_id is null and p_quiz_id is null and p_class_id is null then
    raise exception 'invalid_args: at least one of student_id/quiz_id/class_id required'
      using errcode = '22023';
  end if;

  v_limit  := least(greatest(coalesce(p_limit, 10), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  if p_student_id is not null then
    if not public.is_active_teacher() then
      raise exception 'not_owner' using errcode = '42501';
    end if;
    select coalesce(array_agg(c.id), '{}') into v_class_ids
    from public.classes c
    join public.class_members m on m.class_id = c.id
    where c.teacher_id = auth.uid() and m.student_id = p_student_id;
    if array_length(v_class_ids, 1) is null then
      raise exception 'not_owner' using errcode = '42501';
    end if;
  end if;

  if p_quiz_id is not null then
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
  end if;

  if p_class_id is not null then
    if not public.is_teacher_of_class(p_class_id) then
      raise exception 'not_owner' using errcode = '42501';
    end if;
  end if;

  with scope as (
    select tq.*
    from public.tutor_questions tq
    where (p_student_id is null or tq.student_id = p_student_id)
      and (p_quiz_id    is null or tq.quiz_id    = p_quiz_id)
      and (p_class_id   is null or tq.class_id   = p_class_id)
      and (v_class_ids  is null or tq.class_id = any(v_class_ids))
  ),
  -- Most recent first: a teacher opening the log wants what was just asked.
  page as (
    select * from scope order by created_at desc, id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total',         (select count(*) from scope),
    'flagged_count', (select count(*) from scope where question_id is not null),
    'limit',         v_limit,
    'offset',        v_offset,
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',               p.id,
          'created_at',       p.created_at,
          'prompt',           p.prompt,
          'position_seconds', p.position_seconds,
          'question_id',      p.question_id,
          'question_prompt',  qt.prompt,
          'flagged',          (p.question_id is not null),
          'quiz_id',          p.quiz_id,
          'quiz_title',       z.title,
          'class_id',         p.class_id,
          'class_name',       c.name,
          'student_id',       p.student_id,
          'student_name',     sp.display_name,
          'student_email',    sp.email
        )
        order by p.created_at desc, p.id
      )
      from page p
      join public.quizzes z on z.id = p.quiz_id
      join public.classes c on c.id = p.class_id
      left join public.profiles sp on sp.id = p.student_id
      left join public.question_translations qt
        on qt.question_id = p.question_id and qt.language = z.base_language
    ), '[]'::jsonb),
    'quiz_filters', coalesce((
      select jsonb_agg(
        jsonb_build_object('quiz_id', f.quiz_id, 'title', f.title, 'count', f.cnt)
        order by f.cnt desc, f.title nulls last
      )
      from (
        select s.quiz_id, z.title, count(*) as cnt
        from scope s join public.quizzes z on z.id = s.quiz_id
        group by s.quiz_id, z.title
      ) f
    ), '[]'::jsonb),
    'class_filters', coalesce((
      select jsonb_agg(
        jsonb_build_object('class_id', f.class_id, 'name', f.name, 'count', f.cnt)
        order by f.cnt desc, f.name
      )
      from (
        select s.class_id, c.name, count(*) as cnt
        from scope s join public.classes c on c.id = s.class_id
        group by s.class_id, c.name
      ) f
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- The log is read most-recent-first inside a (student | quiz | class) scope.
create index if not exists idx_tutor_questions_student_created
  on public.tutor_questions(student_id, created_at desc);
create index if not exists idx_tutor_questions_quiz_created
  on public.tutor_questions(quiz_id, created_at desc);
create index if not exists idx_tutor_questions_class_created
  on public.tutor_questions(class_id, created_at desc);

revoke all on function public.tutor_questions_page(uuid, uuid, uuid, int, int) from public;
grant execute on function public.tutor_questions_page(uuid, uuid, uuid, int, int)
  to authenticated, service_role;

-- ============================================================
-- Analytics read only post-edit attempts
--
-- Every teacher-facing analytic ignores attempts started before the quiz's
-- `content_updated_at` (147). Nothing is deleted: the rows stay, and the student
-- paths — `get_attempt_review`, `list_student_feed`, `list_my_attempts_for_quiz`,
-- `get_quiz_for_student` — still read them all, so a student keeps seeing their own
-- results and a finished quiz keeps reading as finished.
--
-- WHOLE ATTEMPTS ARE IN OR OUT, which is why the cut is `attempts.started_at` and
-- not `answers.answered_at`. Most of these functions are attempt-level to begin
-- with (`quiz_stats` averages `attempts.num_correct / num_questions`), so an
-- answer-level cut would leave headline counts including pre-edit data while the
-- per-question table excluded it — the same screen contradicting itself. It also
-- splits a student who was mid-attempt when the teacher saved: pre-edit answers
-- dropped, post-edit answers kept, and their attempt total still covering both.
-- Cutting whole attempts is also the truthful cut, because `attempt_questions`
-- freezes only question MEMBERSHIP — prompt text and `is_correct` are read live, so
-- an in-flight attempt really does see the edit.
--
-- Three views carry the rule so each function keeps its own shape and the
-- predicate lives in exactly one place. They are intentionally ungranted: every
-- caller is a SECURITY DEFINER function running as the owner, so no role needs
-- direct select, and a view (unlike a table) does not enforce the callers' RLS.
--
-- Covered here: the quiz/class/question/tutor analytics (090–093, 122, 131, 138)
-- and the analytics hub's readers (142–145). `teacher_analytics_search` (141) is
-- deliberately NOT in the list — it searches quizzes, classes and students by name
-- and never reads an attempt, so it has nothing to filter.
--
-- A NULL `content_updated_at` means never edited, so every attempt passes.
--
-- CONSEQUENCE, chosen deliberately: this covers progress as well as performance,
-- so after an edit `class_roster_progress` reports nobody as having started while
-- `class_quizzes.max_attempts` still counts each student's pre-edit attempt. A
-- student who finished the old version may be unable to redo the new one. The
-- editor warns before the edit; raising the attempt allowance is a teacher action.
-- ============================================================

create or replace view public.analytics_attempts as
  select a.*
  from public.attempts a
  join public.quizzes q on q.id = a.quiz_id
  where q.content_updated_at is null
     or a.started_at >= q.content_updated_at;

create or replace view public.analytics_answers as
  select ans.*
  from public.answers ans
  join public.analytics_attempts aa on aa.id = ans.attempt_id;

-- A tutor question asked outside an attempt (`attempt_id IS NULL` — the tutor is
-- reachable while merely watching) has no attempt to inherit from, so it falls
-- back to its own `created_at`.
create or replace view public.analytics_tutor_questions as
  select tq.*
  from public.tutor_questions tq
  join public.quizzes q on q.id = tq.quiz_id
  left join public.attempts a on a.id = tq.attempt_id
  where q.content_updated_at is null
     or coalesce(a.started_at, tq.created_at) >= q.content_updated_at;

revoke all on public.analytics_attempts        from anon, authenticated;
revoke all on public.analytics_answers         from anon, authenticated;
revoke all on public.analytics_tutor_questions from anon, authenticated;

-- How many attempts a quiz's cutoff is currently hiding, optionally within one
-- class. This — not `content_updated_at` on its own — is what tells a screen
-- whether to explain itself: authoring the very first question already stamps the
-- quiz (the question set changed), so nearly every quiz carries a non-null
-- cutoff, and a note keyed on that alone would cry wolf on quizzes nobody has
-- ever edited after collecting a single result.
create or replace function public._excluded_attempt_count(
  p_quiz_id  uuid,
  p_class_id uuid default null
)
returns bigint
language sql
security definer
stable
set search_path = public
as $$
  select count(*)
  from public.attempts a
  join public.quizzes q on q.id = a.quiz_id
  where a.quiz_id = p_quiz_id
    and (p_class_id is null or a.class_id = p_class_id)
    and q.content_updated_at is not null
    and a.started_at < q.content_updated_at;
$$;

revoke all on function public._excluded_attempt_count(uuid, uuid) from public, anon, authenticated;


-- ── quiz_stats ──────────────────────────────────────────────────────────────
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
    -- The cutoff every figure below is measured from, and how many attempts it is
    -- hiding. NULL cutoff = never edited; zero excluded = nothing lost to an edit.
    'content_updated_at', (
      select content_updated_at from public.quizzes where id = p_quiz_id
    ),
    'excluded_attempt_count', public._excluded_attempt_count(p_quiz_id),
    -- Attempt-based counts: every post-edit attempt row, anonymized ones included.
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
  from public.analytics_attempts a
  where a.quiz_id = p_quiz_id;

  return v_result;
end;
$$;


-- ── question_stats ──────────────────────────────────────────────────────────
create or replace function public.question_stats(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_lang text;
  v_questions jsonb;
begin
  -- Owner check.
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

  select base_language into v_base_lang from public.quizzes where id = p_quiz_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'question_id', q.id,
        'kind', q.kind,
        'order_index', q.order_index,
        'deleted', (q.deleted_at is not null),
        'position_seconds', q.position_seconds,
        'prompt', qt.prompt,
        'total_answers', (
          select count(*) from public.analytics_answers a where a.question_id = q.id
        ),
        'correct_count', (
          select count(*) from public.analytics_answers a
          where a.question_id = q.id and a.was_correct
        ),
        'correct_pct', (
          select case
                   when count(*) = 0 then null
                   else count(*) filter (where a.was_correct)::numeric / count(*)
                 end
          from public.analytics_answers a
          where a.question_id = q.id
        ),
        'options', (
          -- All options, including soft-deleted, for full distractor history.
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'option_id', o.id,
                'is_correct', o.is_correct,
                'deleted', (o.deleted_at is not null),
                'order_index', o.order_index,
                'text', ot.text,
                'selection_count', (
                  select count(*)
                  from public.answer_selections sel
                  join public.analytics_answers a2 on a2.id = sel.answer_id
                  where sel.option_id = o.id
                    and a2.question_id = q.id
                )
              )
              order by o.order_index, o.id
            ),
            '[]'::jsonb
          )
          from public.question_options o
          left join public.option_translations ot
            on ot.option_id = o.id and ot.language = v_base_lang
          where o.question_id = q.id
        )
      )
      order by q.order_index, q.id
    ),
    '[]'::jsonb
  )
  into v_questions
  from public.questions q
  left join public.question_translations qt
    on qt.question_id = q.id and qt.language = v_base_lang
  where q.quiz_id = p_quiz_id;

  return jsonb_build_object(
    'quiz_id', p_quiz_id,
    'base_language', v_base_lang,
    'questions', v_questions
  );
end;
$$;


-- ── class_stats ─────────────────────────────────────────────────────────────
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
        'content_updated_at', z.content_updated_at,
        'excluded_attempt_count',
          public._excluded_attempt_count(cq.quiz_id, p_class_id),
        'tutor_mode', cq.tutor_mode,
        'max_attempts', cq.max_attempts,
        'attempt_count', (
          select count(*) from public.analytics_attempts a
          where a.class_id = p_class_id and a.quiz_id = cq.quiz_id
        ),
        -- Attempt-based: includes anonymized attempts.
        'completion_count', (
          select count(*) from public.analytics_attempts a
          where a.class_id = p_class_id and a.quiz_id = cq.quiz_id
            and a.completed_at is not null
        ),
        'average_score', (
          select avg((a.num_correct::numeric) / nullif(a.num_questions, 0))
          from public.analytics_attempts a
          where a.class_id = p_class_id and a.quiz_id = cq.quiz_id
            and a.completed_at is not null
            and a.num_questions is not null
            and a.num_questions > 0
        ),
        -- Roster-based: distinct current members who completed (excludes
        -- anonymized/departed students by construction).
        'members_completed', (
          select count(distinct a.student_id)
          from public.analytics_attempts a
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


-- ── tutor_stats ─────────────────────────────────────────────────────────────
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
  from public.analytics_tutor_questions tq
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
    from public.analytics_tutor_questions tq
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


-- ── tutor_prompts_in_scope ──────────────────────────────────────────────────
create or replace function public.tutor_prompts_in_scope(
  p_quiz_id uuid default null,
  p_class_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prompts jsonb;
begin
  -- Exactly one scope required (XOR) — same rule as tutor_stats.
  if (p_quiz_id is null) = (p_class_id is null) then
    raise exception 'invalid_args: exactly one of quiz_id/class_id required'
      using errcode = '22023';
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
  else
    if not public.is_teacher_of_class(p_class_id) then
      raise exception 'not_owner' using errcode = '42501';
    end if;
  end if;

  -- Recent prompts in scope (most recent first, capped for a bounded payload).
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'prompt', f.prompt,
        'question_id', f.question_id,
        'created_at', f.created_at
      )
      order by f.created_at desc
    ),
    '[]'::jsonb
  )
  into v_prompts
  from (
    select tq.prompt, tq.question_id, tq.created_at
    from public.analytics_tutor_questions tq
    where tq.prompt is not null
      and length(btrim(tq.prompt)) > 0
      and (
        (p_quiz_id is not null and tq.quiz_id = p_quiz_id)
        or (p_class_id is not null and tq.class_id = p_class_id)
      )
    order by tq.created_at desc
    limit 500
  ) f;

  return jsonb_build_object(
    'scope', case when p_quiz_id is not null then 'quiz' else 'class' end,
    'prompts', v_prompts
  );
end;
$$;


-- ── class_roster_progress ───────────────────────────────────────────────────
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
    from public.analytics_attempts a
    where a.class_id = p_class_id and a.quiz_id = aq.quiz_id
      and a.student_id = m.student_id
  ) att
  left join lateral (
    select (a2.num_correct::numeric / a2.num_questions) as score
    from public.analytics_attempts a2
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
          from public.analytics_attempts a
          where a.class_id = p_class_id and a.quiz_id = cq.quiz_id
            and a.student_id = m.student_id
        ) att
        left join lateral (
          select a2.num_correct, a2.num_questions,
                 (a2.num_correct::numeric / a2.num_questions) as score
          from public.analytics_attempts a2
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


-- ── student_quiz_progress ───────────────────────────────────────────────────
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
          from public.analytics_attempts a
          where a.class_id = p_class_id and a.quiz_id = cq.quiz_id
            and a.student_id = p_student_id
        ) att
        left join lateral (
          select (a2.num_correct::numeric / a2.num_questions) as score
          from public.analytics_attempts a2
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


-- ── class_quiz_analytics ────────────────────────────────────────────────────
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
  v_content_updated_at timestamptz;
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

  select title, base_language, content_updated_at
    into v_title, v_base_lang, v_content_updated_at
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
    from public.analytics_attempts a
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
  from public.analytics_attempts
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
    from public.analytics_attempts
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
          select count(*) from public.analytics_answers a
          where a.question_id = q.id and a.attempt_id = any(v_latest_ids)
        ),
        'correct_count',    (
          select count(*) from public.analytics_answers a
          where a.question_id = q.id and a.attempt_id = any(v_latest_ids)
            and a.was_correct
        ),
        'correct_pct', (
          select case when count(*) = 0 then null
                      else count(*) filter (where a.was_correct)::numeric / count(*)
                 end
          from public.analytics_answers a
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
                  join public.analytics_answers a2 on a2.id = sel.answer_id
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
    -- The cutoff these figures are measured from, and what it is hiding here.
    'content_updated_at',     v_content_updated_at,
    'excluded_attempt_count',
      public._excluded_attempt_count(p_quiz_id, p_class_id),
    'question_count',     jsonb_array_length(v_questions),
    'member_count',       v_member_count,
    'students_completed', v_students_completed,
    'attempt_count',      (
      select count(*) from public.analytics_attempts
      where class_id = p_class_id and quiz_id = p_quiz_id
    ),
    'completion_count',   (
      select count(*) from public.analytics_attempts
      where class_id = p_class_id and quiz_id = p_quiz_id
        and completed_at is not null
    ),
    'average_score',      v_average_score,
    'score_distribution', v_distribution,
    'questions',          v_questions
  );
end;
$$;


-- ── class_analytics_overview ────────────────────────────────────────────────
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
    from public.analytics_attempts a
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
    from public.analytics_attempts
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
    from public.analytics_attempts a
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
        -- Attempts this row's cutoff is hiding, within this class.
        'content_updated_at',     z.content_updated_at,
        'excluded_attempt_count',
          public._excluded_attempt_count(cq.quiz_id, p_class_id),
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
          from public.analytics_attempts a
          join public.class_members m
            on m.class_id = p_class_id and m.student_id = a.student_id
          where a.class_id = p_class_id and a.quiz_id = cq.quiz_id
            and a.completed_at is not null
        ),
        'students_completed', (
          select count(*) from public.analytics_attempts a
          where a.id = any(v_latest_ids) and a.quiz_id = cq.quiz_id
        ),
        'average_score',      (
          select avg(a.num_correct::numeric / a.num_questions)
          from public.analytics_attempts a
          where a.id = any(v_latest_ids) and a.quiz_id = cq.quiz_id
        ),
        'tutor_question_count', (
          select count(*) from public.analytics_tutor_questions tq
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
      from public.analytics_attempts a where a.id = any(v_latest_ids)
    ),
    'average_score',      (
      select avg(num_correct::numeric / num_questions)
      from public.analytics_attempts where id = any(v_latest_ids)
    ),
    'tutor_question_count', (
      select count(*) from public.analytics_tutor_questions where class_id = p_class_id
    ),
    'score_distribution', v_distribution,
    'completions',        v_completions,
    'quizzes',            v_quizzes
  );
end;
$$;


-- ── student_analytics ───────────────────────────────────────────────────────
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
    from public.analytics_attempts a
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
          from public.analytics_attempts a
          where a.id = any(v_latest_ids)
            and a.class_id = c.id and a.quiz_id = cq.quiz_id
        ),
        'class_students_completed', (
          select count(*) from public.analytics_attempts a
          where a.id = any(v_latest_ids)
            and a.class_id = c.id and a.quiz_id = cq.quiz_id
        ),
        'tutor_question_count', (
          select count(*) from public.analytics_tutor_questions tq
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
    from public.analytics_attempts a
    where a.class_id = c.id and a.quiz_id = cq.quiz_id
      and a.student_id = p_student_id
  ) mine
  left join lateral (
    select (a.num_correct::numeric / a.num_questions) as score
    from public.analytics_attempts a
    where a.class_id = c.id and a.quiz_id = cq.quiz_id
      and a.student_id = p_student_id
      and a.completed_at is not null
      and a.num_questions is not null and a.num_questions > 0
    order by a.attempt_no desc
    limit 1
  ) latest_mine on true
  left join lateral (
    select (a.num_correct::numeric / a.num_questions) as score
    from public.analytics_attempts a
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
          from public.analytics_attempts a
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
      from public.analytics_attempts a
      where a.class_id = c.id and a.quiz_id = cq.quiz_id
        and a.student_id = p_student_id
    ) mine
    left join lateral (
      select (a.num_correct::numeric / a.num_questions) as score
      from public.analytics_attempts a
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
        from public.analytics_attempts a
        join public.class_quizzes cq
          on cq.class_id = a.class_id and cq.quiz_id = a.quiz_id
        join public.quizzes z on z.id = a.quiz_id and z.deleted_at is null
        where a.class_id = any(v_class_ids)
          and a.student_id = p_student_id
          and a.completed_at is not null
      ),
      'average_score', (
        select avg(a.num_correct::numeric / a.num_questions)
        from public.analytics_attempts a
        where a.id = any(v_latest_ids) and a.student_id = p_student_id
      ),
      'peer_average_score', (
        select avg(a.num_correct::numeric / a.num_questions)
        from public.analytics_attempts a
        where a.id = any(v_latest_ids)
          and (a.student_id is distinct from p_student_id)
      ),
      'tutor_question_count', (
        select count(*) from public.analytics_tutor_questions tq
        where tq.student_id = p_student_id and tq.class_id = any(v_class_ids)
      )
    ),
    'classes', v_classes,
    'quizzes', v_quizzes
  );
end;
$$;


-- ── quiz_analytics_overview ─────────────────────────────────────────────────
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
    from public.analytics_attempts a
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
    from public.analytics_attempts
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
          select count(*) from public.analytics_attempts a
          where a.id = any(v_latest_ids) and a.class_id = c.id
        ),
        'attempt_count',      (
          select count(*) from public.analytics_attempts a
          where a.quiz_id = p_quiz_id and a.class_id = c.id
        ),
        'average_score',      (
          select avg(a.num_correct::numeric / a.num_questions)
          from public.analytics_attempts a
          where a.id = any(v_latest_ids) and a.class_id = c.id
        ),
        'tutor_question_count', (
          select count(*) from public.analytics_tutor_questions tq
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
          select count(*) from public.analytics_answers a
          where a.question_id = q.id and a.attempt_id = any(v_latest_ids)
        ),
        'correct_count',    (
          select count(*) from public.analytics_answers a
          where a.question_id = q.id and a.attempt_id = any(v_latest_ids)
            and a.was_correct
        ),
        'correct_pct',      (
          select case when count(*) = 0 then null
                      else count(*) filter (where a.was_correct)::numeric / count(*)
                 end
          from public.analytics_answers a
          where a.question_id = q.id and a.attempt_id = any(v_latest_ids)
        ),
        'tutor_question_count', (
          select count(*) from public.analytics_tutor_questions tq
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
    -- The cutoff every figure here is measured from, and how many attempts it is
    -- hiding. Zero means nothing was lost to an edit, so the view says nothing.
    'content_updated_at',     v_quiz.content_updated_at,
    'excluded_attempt_count', public._excluded_attempt_count(p_quiz_id),
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
        select count(*) from public.analytics_attempts where quiz_id = p_quiz_id
      ),
      'completion_count',   (
        select count(*) from public.analytics_attempts
        where quiz_id = p_quiz_id and completed_at is not null
      ),
      'average_score',      (
        select avg(num_correct::numeric / num_questions)
        from public.analytics_attempts where id = any(v_latest_ids)
      ),
      'tutor_question_count', (
        select count(*) from public.analytics_tutor_questions where quiz_id = p_quiz_id
      )
    ),
    'score_distribution', v_distribution,
    'classes',            v_classes,
    'questions',          v_questions
  );
end;
$$;


-- ── tutor_questions_page ────────────────────────────────────────────────────
create or replace function public.analytics_tutor_questions_page(
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
    from public.analytics_tutor_questions tq
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

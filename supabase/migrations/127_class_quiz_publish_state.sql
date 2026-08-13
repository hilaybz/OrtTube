-- ============================================================
-- Split publication from assignment (Epic 2A.1)
--
-- Until now a `class_quizzes` row meant two things at once: "this class is
-- allocated the quiz" AND "students in it can see it right now." That's fine
-- for one class at a time, but the two ideas need to separate before a quiz
-- can be assigned to several classes in one action (Epic 2A) — otherwise a
-- bulk assignment is instantly live everywhere with no chance to set up first.
--
-- `published` is the new axis. The COLUMN defaults to false (the safe default
-- for any future write path), but `assign_quiz_to_class` keeps its own
-- parameter default of true so the existing single-class "assign" flow is
-- unchanged unless a teacher deliberately drafts it.
--
-- An unpublished assignment is invisible to students in every way an absent
-- one would be: `get_quiz_for_student`, `start_or_resume_attempt`,
-- `list_assigned_for_student` and `get_tutor_mode` all fold it into their
-- existing `not_assigned` path, so nothing distinguishes "not assigned" from
-- "assigned but not published yet." The owner-facing `list_class_quizzes`
-- is deliberately NOT gated — a teacher must always see their own drafts.
-- ============================================================

alter table public.class_quizzes
  add column published boolean not null default false;

-- ── assign_quiz_to_class ──────────────────────────────────────────────────────
-- Adds p_published (default true, preserving today's instant-publish UX for the
-- single-class flow). Everything else unchanged from 051_class_assignment_rpcs.sql.
create or replace function public.assign_quiz_to_class(
  p_class_id     uuid,
  p_quiz_id      uuid,
  p_tutor_mode   text default 'hints',
  p_max_attempts int  default 1,
  p_published    boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class public.classes;
  v_quiz  public.quizzes;
begin
  v_class := public._assert_class_owner(p_class_id);

  if p_tutor_mode is null or p_tutor_mode not in ('off','hints','full') then
    raise exception 'invalid_tutor_mode' using errcode = 'P0001';
  end if;
  if p_max_attempts is not null and p_max_attempts < 1 then
    raise exception 'invalid_max_attempts' using errcode = 'P0001';
  end if;

  select * into v_quiz from public.quizzes where id = p_quiz_id;
  if not found or v_quiz.deleted_at is not null then
    raise exception 'quiz_not_found' using errcode = 'P0002';
  end if;
  if v_quiz.school_id <> v_class.school_id then
    raise exception 'cross_school' using errcode = 'P0001';
  end if;
  if v_quiz.author_id <> auth.uid() and v_quiz.visibility <> 'shared' then
    raise exception 'quiz_forbidden' using errcode = 'P0001';
  end if;

  insert into public.class_quizzes (class_id, quiz_id, tutor_mode, max_attempts, published)
    values (p_class_id, p_quiz_id, p_tutor_mode, p_max_attempts, p_published)
    on conflict (class_id, quiz_id) do update
      set tutor_mode   = excluded.tutor_mode,
          max_attempts = excluded.max_attempts,
          published    = excluded.published;

  return jsonb_build_object(
    'class_id',       p_class_id,
    'quiz_id',        p_quiz_id,
    'tutor_mode',     p_tutor_mode,
    'max_attempts',   p_max_attempts,
    'published',      p_published,
    'class_language', v_class.language,
    'base_language',  v_quiz.base_language
  );
end;
$$;

revoke all on function public.assign_quiz_to_class(uuid, uuid, text, int, boolean) from public;
grant execute on function public.assign_quiz_to_class(uuid, uuid, text, int, boolean) to authenticated, service_role;

-- The old 4-arg signature is superseded by the 5-arg one above; drop it so callers
-- can't accidentally hit a stale overload that always publishes.
drop function if exists public.assign_quiz_to_class(uuid, uuid, text, int);

-- ── set_class_quiz_published ──────────────────────────────────────────────────
-- Flip an existing assignment's published state without touching tutor_mode or
-- max_attempts. Same owner-check shape as unassign_quiz.
create or replace function public.set_class_quiz_published(
  p_class_id  uuid,
  p_quiz_id   uuid,
  p_published boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert_class_owner(p_class_id);
  update public.class_quizzes
    set published = p_published
    where class_id = p_class_id and quiz_id = p_quiz_id;
  if not found then
    raise exception 'not_assigned' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_class_quiz_published(uuid, uuid, boolean) from public;
grant execute on function public.set_class_quiz_published(uuid, uuid, boolean) to authenticated, service_role;

-- ── list_class_quizzes ────────────────────────────────────────────────────────
-- Owner-facing; now also reports published state. Never gated on it — an owner
-- must always see their own drafts.
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
               'assigned_at',      cq.assigned_at,
               'question_count',   (
                 select count(*) from public.questions qs
                 where qs.quiz_id = q.id and qs.deleted_at is null
               )
             ) order by cq.assigned_at desc
           )
    from public.class_quizzes cq
    join public.quizzes q on q.id = cq.quiz_id
    join public.videos  v on v.id = q.video_id
    where cq.class_id = p_class_id
      and q.deleted_at is null
  ), '[]'::jsonb);
end;
$$;

-- ── list_assigned_for_student ─────────────────────────────────────────────────
-- Now only lists PUBLISHED assignments; unpublished ones are invisible, same as
-- if they didn't exist.
create or replace function public.list_assigned_for_student()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'class_id',   c.id,
               'class_name', c.name,
               'language',   c.language,
               'quizzes',    coalesce((
                 select jsonb_agg(
                          jsonb_build_object(
                            'quiz_id',          q.id,
                            'title',            q.title,
                            'base_language',    q.base_language,
                            'video_id',         v.id,
                            'youtube_video_id', v.youtube_video_id,
                            'video_title',      v.title,
                            'tutor_mode',       cq.tutor_mode,
                            'max_attempts',     cq.max_attempts,
                            'assigned_at',      cq.assigned_at
                          ) order by cq.assigned_at desc
                        )
                 from public.class_quizzes cq
                 join public.quizzes q on q.id = cq.quiz_id
                 join public.videos  v on v.id = q.video_id
                 where cq.class_id = c.id
                   and q.deleted_at is null
                   and cq.published
               ), '[]'::jsonb)
             ) order by c.name
           )
    from public.class_members m
    join public.classes c on c.id = m.class_id
    where m.student_id = auth.uid()
  ), '[]'::jsonb);
end;
$$;

-- ── get_quiz_for_student ──────────────────────────────────────────────────────
-- Reproduced in full from 126_order_questions_by_video_time.sql with one added
-- condition on the assignment join: an unpublished assignment now raises the
-- same not_assigned a missing one would.
create or replace function public.get_quiz_for_student(
  p_class_id uuid,
  p_quiz_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student    uuid := auth.uid();
  v_quiz       public.quizzes;
  v_pref       text;
  v_class_lang text;
  v_resolved   text;
  v_questions  jsonb;
  v_complete   boolean;
  v_attempt_id uuid;
begin
  if v_student is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  -- Membership: the caller must be enrolled in the class.
  if not exists (
    select 1 from public.class_members m
    where m.class_id = p_class_id and m.student_id = v_student
  ) then
    raise exception 'not_member' using errcode = 'P0001';
  end if;

  -- Assignment + quiz existence/non-deleted/published. A soft-deleted or
  -- unpublished quiz must stop appearing even though its class_quizzes row
  -- still exists.
  select q.* into v_quiz
  from public.quizzes q
  join public.class_quizzes cq
    on cq.quiz_id = q.id and cq.class_id = p_class_id and cq.published
  where q.id = p_quiz_id and q.deleted_at is null;
  if not found then
    raise exception 'not_assigned' using errcode = 'P0002';
  end if;

  -- Resolve the read language by precedence (spec §3.4). base_language is the
  -- guaranteed fallback (NOT NULL column).
  select preferred_language into v_pref from public.profiles where id = v_student;
  select language into v_class_lang from public.classes where id = p_class_id;
  v_resolved := coalesce(
    case when v_pref       in ('he','ar','en') then v_pref       end,
    case when v_class_lang in ('he','ar','en') then v_class_lang end,
    v_quiz.base_language
  );

  -- Serve the FROZEN snapshot for an in-progress attempt (spec §3.5). If the
  -- student has an incomplete attempt on this (class, quiz), we serve exactly the
  -- questions captured in attempt_questions at start — INCLUDING any question
  -- soft-deleted mid-attempt — so the student can answer precisely what they will
  -- be scored on (a since-deleted snapshot question would otherwise be unanswerable
  -- and cap the score below 100%). With no active attempt (preview / not yet
  -- started) we serve the live, non-deleted set.
  select a.id into v_attempt_id
  from public.attempts a
  where a.student_id = v_student
    and a.class_id   = p_class_id
    and a.quiz_id    = p_quiz_id
    and a.completed_at is null
  order by a.attempt_no desc
  limit 1;

  -- Build the question list. Per row we prefer the resolved-language translation
  -- and fall back to the base-language row when it is missing. `row_complete`
  -- flags whether the resolved language was fully available (question prompt +
  -- every live option) so the caller can decide whether to enqueue a translation.
  select
    coalesce(jsonb_agg(sub.qj order by sub.q_pos, sub.q_order, sub.q_id), '[]'::jsonb),
    bool_and(sub.row_complete)
  into v_questions, v_complete
  from (
    select
      q.id                 as q_id,
      q.order_index        as q_order,
      q.position_seconds   as q_pos,
      (
        qt_r.question_id is not null
        and not exists (
          select 1
          from public.question_options o
          left join public.option_translations otr
            on otr.option_id = o.id and otr.language = v_resolved
          where o.question_id = q.id
            and o.deleted_at is null
            and otr.option_id is null
        )
      ) as row_complete,
      jsonb_build_object(
        'id',               q.id,
        'kind',             q.kind,
        'position_seconds', q.position_seconds,
        'order_index',      q.order_index,
        'prompt',           coalesce(qt_r.prompt, qt_b.prompt),
        -- NO explanation in the answer-free load payload: an explanation can
        -- reveal the correct answer. Explanations are delivered only via
        -- get_attempt_review, and only once the reveal rule is satisfied.
        'options', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'id',          o.id,
                     'order_index', o.order_index,
                     'text',        coalesce(otr.text, otb.text)
                   ) order by o.order_index, o.id
                 )
          from public.question_options o
          left join public.option_translations otr
            on otr.option_id = o.id and otr.language = v_resolved
          left join public.option_translations otb
            on otb.option_id = o.id and otb.language = v_quiz.base_language
          where o.question_id = q.id and o.deleted_at is null
        ), '[]'::jsonb)
      ) as qj
    from public.questions q
    left join public.question_translations qt_r
      on qt_r.question_id = q.id and qt_r.language = v_resolved
    left join public.question_translations qt_b
      on qt_b.question_id = q.id and qt_b.language = v_quiz.base_language
    where q.quiz_id = p_quiz_id
      and (
        -- in-progress attempt → the frozen snapshot (incl. since-soft-deleted)
        (v_attempt_id is not null and exists (
           select 1 from public.attempt_questions aq
           where aq.attempt_id = v_attempt_id and aq.question_id = q.id
         ))
        -- no active attempt → the live, non-deleted set
        or (v_attempt_id is null and q.deleted_at is null)
      )
  ) sub;

  return jsonb_build_object(
    'quiz_id',           v_quiz.id,
    'class_id',          p_class_id,
    'title',             v_quiz.title,
    'base_language',     v_quiz.base_language,
    'resolved_language', v_resolved,
    -- true when there were no questions, or every resolved-language row was present.
    'served_complete',   coalesce(v_complete, true),
    'questions',         v_questions
  );
end;
$$;

revoke all on function public.get_quiz_for_student(uuid, uuid) from public;
grant execute on function public.get_quiz_for_student(uuid, uuid) to authenticated, service_role;

-- ── start_or_resume_attempt ───────────────────────────────────────────────────
-- Reproduced in full from 126_order_questions_by_video_time.sql with one added
-- condition on the assignment lookup: unpublished folds into not_assigned.
create or replace function public.start_or_resume_attempt(
  p_class_id uuid,
  p_quiz_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student   uuid := auth.uid();
  v_cq        public.class_quizzes;
  v_existing  public.attempts;
  v_completed int;
  v_next_no   int;
  v_attempt   public.attempts;
  v_answered  jsonb;
begin
  if v_student is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.class_members m
    where m.class_id = p_class_id and m.student_id = v_student
  ) then
    raise exception 'not_member' using errcode = 'P0001';
  end if;

  select cq.* into v_cq
  from public.class_quizzes cq
  join public.quizzes q on q.id = cq.quiz_id
  where cq.class_id = p_class_id and cq.quiz_id = p_quiz_id
    and q.deleted_at is null and cq.published;
  if not found then
    raise exception 'not_assigned' using errcode = 'P0002';
  end if;

  -- Serialize the whole allocation for this (student, class, quiz). The lock is
  -- transaction-scoped, so it is held only for this quick txn — safe under the
  -- transaction-mode pooler (plan §0). Taken before the resume/max checks so two
  -- concurrent starts cannot both pass max_attempts or both allocate the same no.
  perform pg_advisory_xact_lock(
    hashtextextended(v_student::text || '|' || p_class_id::text || '|' || p_quiz_id::text, 0)
  );

  -- Resume the newest incomplete attempt, if any.
  select * into v_existing
  from public.attempts
  where student_id = v_student and class_id = p_class_id and quiz_id = p_quiz_id
    and completed_at is null
  order by attempt_no desc
  limit 1;

  if found then
    select coalesce(jsonb_agg(question_id), '[]'::jsonb) into v_answered
    from public.answers where attempt_id = v_existing.id;
    return jsonb_build_object(
      'attempt_id',            v_existing.id,
      'attempt_no',            v_existing.attempt_no,
      'resumed',               true,
      'started_at',            v_existing.started_at,
      'answered_question_ids', v_answered
    );
  end if;

  -- Enforce max_attempts — completed attempts only.
  select count(*) into v_completed
  from public.attempts
  where student_id = v_student and class_id = p_class_id and quiz_id = p_quiz_id
    and completed_at is not null;

  if v_cq.max_attempts is not null and v_completed >= v_cq.max_attempts then
    raise exception 'no_attempts_left' using errcode = 'P0001';
  end if;

  select coalesce(max(attempt_no), 0) + 1 into v_next_no
  from public.attempts
  where student_id = v_student and class_id = p_class_id and quiz_id = p_quiz_id;

  insert into public.attempts (student_id, class_id, quiz_id, attempt_no)
  values (v_student, p_class_id, p_quiz_id, v_next_no)
  returning * into v_attempt;

  -- Materialize the start-time question snapshot.
  insert into public.attempt_questions (attempt_id, question_id, order_index)
  select v_attempt.id, q.id,
         row_number() over (order by q.position_seconds, q.order_index, q.id)
  from public.questions q
  where q.quiz_id = p_quiz_id and q.deleted_at is null;

  return jsonb_build_object(
    'attempt_id',            v_attempt.id,
    'attempt_no',            v_attempt.attempt_no,
    'resumed',               false,
    'started_at',            v_attempt.started_at,
    'answered_question_ids', '[]'::jsonb
  );
end;
$$;

revoke all on function public.start_or_resume_attempt(uuid, uuid) from public;
grant execute on function public.start_or_resume_attempt(uuid, uuid) to authenticated, service_role;

-- ── get_tutor_mode ─────────────────────────────────────────────────────────────
-- Reproduced in full from 070_tutor_rpcs.sql with one added condition: an
-- unpublished assignment is not tutorable, same not_assigned as unassigned.
create or replace function public.get_tutor_mode(
  p_class_id uuid,
  p_quiz_id  uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid                uuid := auth.uid();
  v_mode               text;
  v_class_language     text;
  v_base_language      text;
  v_preferred_language text;
  v_video_id           uuid;
  v_youtube_video_id   text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- Membership gate: only students enrolled in the class may tutor its quizzes.
  if not public.is_member_of_class(p_class_id) then
    raise exception 'not_member' using errcode = 'P0001';
  end if;

  -- Assignment + content context in one join. No deleted_at filter on the quiz:
  -- an assigned quiz stays tutorable for enrolled students (plan Appendix C —
  -- deactivation/removal gates the owner, not enrolled students). Must be
  -- published, same as every other student-facing read.
  select cq.tutor_mode, c.language, q.base_language, q.video_id, v.youtube_video_id
    into v_mode, v_class_language, v_base_language, v_video_id, v_youtube_video_id
    from public.class_quizzes cq
    join public.classes c on c.id = cq.class_id
    join public.quizzes  q on q.id = cq.quiz_id
    join public.videos   v on v.id = q.video_id
   where cq.class_id = p_class_id
     and cq.quiz_id  = p_quiz_id
     and cq.published;

  if not found then
    raise exception 'not_assigned' using errcode = 'P0001';
  end if;

  select preferred_language
    into v_preferred_language
    from public.profiles
   where id = v_uid;

  return jsonb_build_object(
    'tutor_mode',         v_mode,
    'class_language',     v_class_language,
    'base_language',      v_base_language,
    'preferred_language', v_preferred_language,
    'video_id',           v_video_id,
    'youtube_video_id',   v_youtube_video_id
  );
end;
$$;

revoke all on function public.get_tutor_mode(uuid, uuid) from public;
grant execute on function public.get_tutor_mode(uuid, uuid) to authenticated, service_role;

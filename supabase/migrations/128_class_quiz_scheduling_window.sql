-- ============================================================
-- Per-allocation scheduling window (Epic 2A.2)
--
-- `available_from` / `available_until` — either or both nullable — bound WHEN a
-- published allocation is actually visible to students. Both null (the default
-- for every existing row) means "no window," identical to today's behaviour.
--
-- `_allocation_is_live` is the one place "is this allocation currently visible"
-- is decided: published AND (no start bound, or it has passed) AND (no end
-- bound, or it hasn't passed yet). Every place 127 added `and cq.published`
-- swaps that for `and public._allocation_is_live(cq)` — a not-yet-open or
-- already-closed window is exactly as invisible to a student as an unpublished
-- or absent assignment; same not_assigned everywhere, same reasoning as 127.
--
-- The hard-cutoff BEHAVIOUR at the close instant (force-completing an
-- in-progress attempt, the reveal-gate interaction, the sweep job) is
-- 129_attempt_window_finalization.sql — this migration is the column + the
-- read-gate only.
-- ============================================================

alter table public.class_quizzes
  add column available_from  timestamptz,
  add column available_until timestamptz;

-- ── _allocation_is_live ───────────────────────────────────────────────────────
create or replace function public._allocation_is_live(cq public.class_quizzes)
returns boolean
language sql
stable
as $$
  select cq.published
     and (cq.available_from  is null or cq.available_from  <= now())
     and (cq.available_until is null or cq.available_until >  now());
$$;

revoke all on function public._allocation_is_live(public.class_quizzes) from public;
grant execute on function public._allocation_is_live(public.class_quizzes) to authenticated, service_role;

-- ── assign_quiz_to_class ──────────────────────────────────────────────────────
-- Adds p_available_from / p_available_until (both default null = no window).
-- Everything else unchanged from 127_class_quiz_publish_state.sql.
create or replace function public.assign_quiz_to_class(
  p_class_id        uuid,
  p_quiz_id         uuid,
  p_tutor_mode      text default 'hints',
  p_max_attempts    int  default 1,
  p_published       boolean default true,
  p_available_from  timestamptz default null,
  p_available_until timestamptz default null
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
  if p_available_from is not null and p_available_until is not null
     and p_available_from >= p_available_until then
    raise exception 'invalid_schedule_window' using errcode = 'P0001';
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

  insert into public.class_quizzes (
    class_id, quiz_id, tutor_mode, max_attempts, published,
    available_from, available_until
  )
    values (
      p_class_id, p_quiz_id, p_tutor_mode, p_max_attempts, p_published,
      p_available_from, p_available_until
    )
    on conflict (class_id, quiz_id) do update
      set tutor_mode       = excluded.tutor_mode,
          max_attempts     = excluded.max_attempts,
          published        = excluded.published,
          available_from   = excluded.available_from,
          available_until  = excluded.available_until;

  return jsonb_build_object(
    'class_id',         p_class_id,
    'quiz_id',          p_quiz_id,
    'tutor_mode',       p_tutor_mode,
    'max_attempts',     p_max_attempts,
    'published',        p_published,
    'available_from',   p_available_from,
    'available_until',  p_available_until,
    'class_language',   v_class.language,
    'base_language',    v_quiz.base_language
  );
end;
$$;

revoke all on function public.assign_quiz_to_class(uuid, uuid, text, int, boolean, timestamptz, timestamptz) from public;
grant execute on function public.assign_quiz_to_class(uuid, uuid, text, int, boolean, timestamptz, timestamptz) to authenticated, service_role;

-- The old 5-arg signature is superseded by the 7-arg one above; drop it so
-- callers can't accidentally hit a stale overload with no window support.
drop function if exists public.assign_quiz_to_class(uuid, uuid, text, int, boolean);

-- ── set_class_quiz_schedule ───────────────────────────────────────────────────
-- Edit an existing allocation's window without touching tutor_mode,
-- max_attempts or published. Same owner-checked shape as set_class_quiz_published.
create or replace function public.set_class_quiz_schedule(
  p_class_id        uuid,
  p_quiz_id         uuid,
  p_available_from  timestamptz default null,
  p_available_until timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert_class_owner(p_class_id);
  if p_available_from is not null and p_available_until is not null
     and p_available_from >= p_available_until then
    raise exception 'invalid_schedule_window' using errcode = 'P0001';
  end if;
  update public.class_quizzes
    set available_from  = p_available_from,
        available_until = p_available_until
    where class_id = p_class_id and quiz_id = p_quiz_id;
  if not found then
    raise exception 'not_assigned' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_class_quiz_schedule(uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function public.set_class_quiz_schedule(uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;

-- ── list_class_quizzes ────────────────────────────────────────────────────────
-- Owner-facing; now also reports the window. Never gated — an owner must
-- always see their own drafts / scheduled / closed allocations.
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
-- Now only lists LIVE assignments (published AND inside its window); a
-- scheduled-but-not-open or already-closed one is invisible, same as absent.
-- Carries the window through so the feed can show a due date.
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
                            'available_from',   cq.available_from,
                            'available_until',  cq.available_until,
                            'assigned_at',      cq.assigned_at
                          ) order by cq.assigned_at desc
                        )
                 from public.class_quizzes cq
                 join public.quizzes q on q.id = cq.quiz_id
                 join public.videos  v on v.id = q.video_id
                 where cq.class_id = c.id
                   and q.deleted_at is null
                   and public._allocation_is_live(cq)
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
-- Reproduced in full from 127_class_quiz_publish_state.sql with one change: the
-- assignment join now requires _allocation_is_live instead of bare `published`.
-- (The deadline fields the player's cutoff timer needs live on
-- list_my_attempts_for_quiz below, not here — that's the read the player
-- actually loads on mount; this one is fetched lazily after Start is clicked.)
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

  -- Assignment + quiz existence/non-deleted/live. A soft-deleted quiz or a
  -- draft/scheduled/closed allocation must stop appearing even though its
  -- class_quizzes row still exists.
  select q.* into v_quiz
  from public.quizzes q
  join public.class_quizzes cq
    on cq.quiz_id = q.id and cq.class_id = p_class_id
    and public._allocation_is_live(cq)
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
-- Reproduced in full from 127_class_quiz_publish_state.sql with one change: the
-- assignment lookup now requires _allocation_is_live instead of bare `published`.
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
    and q.deleted_at is null and public._allocation_is_live(cq);
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
-- Reproduced in full from 070_tutor_rpcs.sql with one change: the assignment
-- lookup now requires _allocation_is_live instead of bare `published`.
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
  -- live, same as every other student-facing read.
  select cq.tutor_mode, c.language, q.base_language, q.video_id, v.youtube_video_id
    into v_mode, v_class_language, v_base_language, v_video_id, v_youtube_video_id
    from public.class_quizzes cq
    join public.classes c on c.id = cq.class_id
    join public.quizzes  q on q.id = cq.quiz_id
    join public.videos   v on v.id = q.video_id
   where cq.class_id = p_class_id
     and cq.quiz_id  = p_quiz_id
     and public._allocation_is_live(cq);

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

-- ── list_my_attempts_for_quiz ──────────────────────────────────────────────────
-- Reproduced in full from 120_list_my_attempts_for_quiz.sql. Two changes:
--
-- 1. FIXES A GAP LEFT BY 127: this RPC's assignment join only ever checked
--    `q.deleted_at is null` — it was never gated on `published` when 2A.1
--    shipped, so a draft allocation's video/tutor_mode/max_attempts leaked
--    through the player's deep-link/refresh read even though every other
--    student-facing read was correctly closed. Fixed here alongside adding the
--    window check, both via the same `_allocation_is_live(cq)` condition the
--    other four reads use.
-- 2. Adds `available_until` + `server_now`: this is the read the player loads
--    on mount (before Start is even clicked), so it's the right place for the
--    clock-skew-proof deadline the cutoff timer needs — not
--    get_quiz_for_student, which is fetched lazily after Start.
create or replace function public.list_my_attempts_for_quiz(
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
  v_student        uuid := auth.uid();
  v_tutor_mode     text;
  v_max_attempts   int;
  v_available_until timestamptz;
  v_base_language  text;
  v_youtube_id     text;
  v_video_title    text;
  v_duration       int;
  v_attempt_count  int;
  v_completed      int;
  v_attempts_left  int;
  v_resume_id      uuid;
  v_last_completed public.attempts;
begin
  if v_student is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  if not public.is_member_of_class(p_class_id) then
    raise exception 'not_member' using errcode = 'P0001';
  end if;

  -- Assignment + content context in one join (quiz must be non-deleted, the
  -- allocation must be live: published and inside its window).
  select cq.tutor_mode, cq.max_attempts, cq.available_until, q.base_language,
         v.youtube_video_id, v.title, v.duration_seconds
    into v_tutor_mode, v_max_attempts, v_available_until, v_base_language,
         v_youtube_id, v_video_title, v_duration
    from public.class_quizzes cq
    join public.quizzes q on q.id = cq.quiz_id
    join public.videos  v on v.id = q.video_id
   where cq.class_id = p_class_id
     and cq.quiz_id  = p_quiz_id
     and q.deleted_at is null
     and public._allocation_is_live(cq);
  if not found then
    raise exception 'not_assigned' using errcode = 'P0002';
  end if;

  select
    count(*),
    count(*) filter (where completed_at is not null)
    into v_attempt_count, v_completed
  from public.attempts
  where student_id = v_student and class_id = p_class_id and quiz_id = p_quiz_id;

  -- null max_attempts = unlimited (attempts_left stays null).
  v_attempts_left := case
    when v_max_attempts is null then null
    else greatest(v_max_attempts - v_completed, 0)
  end;

  -- Newest incomplete attempt (resume target), if any.
  select id into v_resume_id
  from public.attempts
  where student_id = v_student and class_id = p_class_id and quiz_id = p_quiz_id
    and completed_at is null
  order by attempt_no desc
  limit 1;

  -- Newest completed attempt (score + review entry point), if any.
  select * into v_last_completed
  from public.attempts
  where student_id = v_student and class_id = p_class_id and quiz_id = p_quiz_id
    and completed_at is not null
  order by attempt_no desc
  limit 1;

  return jsonb_build_object(
    'class_id',                 p_class_id,
    'quiz_id',                  p_quiz_id,
    'youtube_video_id',         v_youtube_id,
    'video_title',              v_video_title,
    'duration_seconds',         v_duration,
    'base_language',            v_base_language,
    'tutor_mode',               v_tutor_mode,
    'max_attempts',             v_max_attempts,
    -- Deadline info for the player's clock-skew-proof cutoff timer (null when
    -- the allocation has no end bound).
    'available_until',          v_available_until,
    'server_now',               now(),
    'attempt_count',            v_attempt_count,
    'completed_count',          v_completed,
    'attempts_left',            v_attempts_left,
    'in_progress',              v_resume_id is not null,
    'resume_attempt_id',        v_resume_id,
    'last_completed_attempt_id',v_last_completed.id,
    'last_num_correct',         v_last_completed.num_correct,
    'last_num_questions',       v_last_completed.num_questions
  );
end;
$$;

revoke all on function public.list_my_attempts_for_quiz(uuid, uuid) from public;
grant execute on function public.list_my_attempts_for_quiz(uuid, uuid) to authenticated, service_role;

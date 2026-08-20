-- ============================================================
-- Quiz duration (issue #80) — a per-quiz `time_restricted` toggle.
--
-- Restricted: the teacher states an exact minute count (`duration_minutes`),
-- shown to students/teachers as a bare number, no `~`.
-- Unrestricted (default): no stored number — the UI derives an ESTIMATE from
-- the video's length (`videos.duration_seconds`, rounded up to the next
-- 5-minute increment) and always prefixes it with `~`. See lib/quizDuration.ts
-- for the shared formula; nothing here stores the estimate, since it's pure
-- and cheap to recompute from data already being selected.
--
-- `duration_minutes` is only ever non-null while `time_restricted` is true —
-- enforced both by the CHECK constraint (belt) and by every RPC that writes
-- these columns (suspenders): going unrestricted always clears the number,
-- and going restricted always requires a positive one.
-- ============================================================

alter table public.quizzes
  add column time_restricted boolean not null default false,
  add column duration_minutes int,
  add constraint quizzes_duration_consistent check (
    (time_restricted and duration_minutes is not null and duration_minutes > 0)
    or (not time_restricted and duration_minutes is null)
  );

-- ── create_quiz_for_video: gains time_restricted + duration_minutes ────────
-- Adding trailing parameters changes the function's argument-type identity,
-- so (as with 132's own channel_name addition) `create or replace` alone
-- would leave the old signature behind as a stale overload — drop first.
drop function if exists public.create_quiz_for_video(text, text, int, text, text, text);

create or replace function public.create_quiz_for_video(
  p_youtube_id        text,
  p_video_title       text,
  p_duration_seconds  int,
  p_base_language     text,
  p_quiz_title        text,
  p_channel_name      text default null,
  p_time_restricted   boolean default false,
  p_duration_minutes  int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid;
  v_video_id  uuid;
  v_status    text;
  v_quiz      public.quizzes;
begin
  -- Caller must be an active teacher; derive the school from their profile.
  select school_id into v_school_id
  from public.profiles
  where id = auth.uid() and role = 'teacher' and deactivated_at is null;
  if not found then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if p_base_language is null or p_base_language not in ('he','ar','en') then
    raise exception 'invalid_base_language' using errcode = 'P0001';
  end if;

  -- Mirrors the CHECK constraint, so a bad combination fails with a clean
  -- code here rather than surfacing the raw constraint-violation message.
  if p_time_restricted and (p_duration_minutes is null or p_duration_minutes <= 0) then
    raise exception 'invalid_duration' using errcode = 'P0001';
  end if;
  if not p_time_restricted and p_duration_minutes is not null then
    raise exception 'invalid_duration' using errcode = 'P0001';
  end if;

  -- Upsert the shared, ownerless video row (dedup by youtube_video_id). On a
  -- conflict, backfill only whichever of title/duration/channel_name is
  -- currently NULL — never overwrite a value that is already set.
  insert into public.videos (youtube_video_id, title, duration_seconds, channel_name)
  values (p_youtube_id, p_video_title, p_duration_seconds, p_channel_name)
  on conflict (youtube_video_id) do update
    set title            = coalesce(videos.title, excluded.title),
        duration_seconds = coalesce(videos.duration_seconds, excluded.duration_seconds),
        channel_name     = coalesce(videos.channel_name, excluded.channel_name);

  select id, transcript_status into v_video_id, v_status
  from public.videos where youtube_video_id = p_youtube_id;

  insert into public.quizzes (
    author_id, video_id, school_id, base_language, title,
    time_restricted, duration_minutes
  )
  values (
    auth.uid(), v_video_id, v_school_id, p_base_language, p_quiz_title,
    p_time_restricted, p_duration_minutes
  )
  returning * into v_quiz;

  return jsonb_build_object(
    'quiz_id',           v_quiz.id,
    'video_id',          v_video_id,
    'youtube_video_id',  p_youtube_id,
    'school_id',         v_school_id,
    'base_language',     v_quiz.base_language,
    'title',             v_quiz.title,
    'visibility',        v_quiz.visibility,
    'transcript_status', v_status,
    'created_at',        v_quiz.created_at,
    'time_restricted',   v_quiz.time_restricted,
    'duration_minutes',  v_quiz.duration_minutes
  );
end;
$$;

-- ── update_quiz: gains time_restricted + duration_minutes ──────────────────
-- Same drop-first reasoning as above. p_time_restricted keeps this RPC's
-- existing "NULL means unchanged" convention; going unrestricted (false)
-- always clears duration_minutes regardless of what else was passed.
drop function if exists public.update_quiz(uuid, text, text, text);

create or replace function public.update_quiz(
  p_quiz_id           uuid,
  p_title             text default null,
  p_visibility        text default null,
  p_base_language     text default null,
  p_time_restricted   boolean default null,
  p_duration_minutes  int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert_quiz_owner(p_quiz_id);

  if p_visibility is not null and p_visibility not in ('private','shared') then
    raise exception 'invalid_visibility' using errcode = 'P0001';
  end if;
  if p_base_language is not null and p_base_language not in ('he','ar','en') then
    raise exception 'invalid_base_language' using errcode = 'P0001';
  end if;
  if p_time_restricted and (p_duration_minutes is null or p_duration_minutes <= 0) then
    raise exception 'invalid_duration' using errcode = 'P0001';
  end if;

  update public.quizzes
    set title            = case
                              when p_title is null      then title
                              when btrim(p_title) = ''  then null
                              else btrim(p_title)
                            end,
        visibility       = coalesce(p_visibility, visibility),
        base_language    = coalesce(p_base_language, base_language),
        time_restricted  = coalesce(p_time_restricted, time_restricted),
        duration_minutes = case
                              when p_time_restricted is null then duration_minutes
                              when p_time_restricted         then p_duration_minutes
                              else null
                            end
    where id = p_quiz_id;
end;
$$;

-- ── get_quiz_for_author: gains time_restricted + duration_minutes ──────────
-- Returns bare jsonb (no RETURNS TABLE shape) — plain create or replace.
create or replace function public.get_quiz_for_author(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_lang text;
  v_quiz      jsonb;
  v_video     jsonb;
  v_questions jsonb;
  v_languages jsonb;
begin
  -- Owner check (author of the quiz, non-deactivated), matching analytics.
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

  -- Quiz meta + canonical video.
  select
    jsonb_build_object(
      'quiz_id',          q.id,
      'title',            q.title,
      'base_language',    q.base_language,
      'visibility',       q.visibility,
      'time_restricted',  q.time_restricted,
      'duration_minutes', q.duration_minutes
    ),
    jsonb_build_object(
      'id',               v.id,
      'youtube_video_id', v.youtube_video_id,
      'title',            v.title,
      'duration_seconds', v.duration_seconds,
      'transcript_status', v.transcript_status
    )
  into v_quiz, v_video
  from public.quizzes q
  join public.videos v on v.id = q.video_id
  where q.id = p_quiz_id;

  -- Non-deleted questions with base-language text and their non-deleted options.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',               q.id,
        'kind',             q.kind,
        'position_seconds', q.position_seconds,
        'order_index',      q.order_index,
        'prompt',           qt.prompt,
        'explanation',      qt.explanation,
        'source',           qt.source,
        'options', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id',          o.id,
                'is_correct',  o.is_correct,
                'order_index', o.order_index,
                'text',        ot.text
              )
              order by o.order_index, o.id
            ),
            '[]'::jsonb
          )
          from public.question_options o
          left join public.option_translations ot
            on ot.option_id = o.id and ot.language = v_base_lang
          where o.question_id = q.id
            and o.deleted_at is null
        )
      )
      order by q.position_seconds, q.order_index, q.id
    ),
    '[]'::jsonb
  )
  into v_questions
  from public.questions q
  left join public.question_translations qt
    on qt.question_id = q.id and qt.language = v_base_lang
  where q.quiz_id = p_quiz_id
    and q.deleted_at is null;

  -- Non-base languages that already have any translation row (question or option).
  select coalesce(jsonb_agg(distinct lang), '[]'::jsonb)
  into v_languages
  from (
    select qt.language as lang
    from public.question_translations qt
    join public.questions q on q.id = qt.question_id
    where q.quiz_id = p_quiz_id
      and qt.language <> v_base_lang
    union
    select ot.language as lang
    from public.option_translations ot
    join public.question_options o on o.id = ot.option_id
    join public.questions q on q.id = o.question_id
    where q.quiz_id = p_quiz_id
      and ot.language <> v_base_lang
  ) langs;

  return v_quiz
    || jsonb_build_object(
         'video',                v_video,
         'transcript_status',    v_video->'transcript_status',
         'questions',            v_questions,
         'translated_languages', v_languages
       );
end;
$$;

-- ── list_my_quizzes: gains time_restricted, duration_minutes, duration_seconds
-- `create or replace` cannot change a RETURNS TABLE(...) shape in place
-- (Postgres error 42P13) — must drop first, same pattern as 132/133.
drop function if exists public.list_my_quizzes();

create or replace function public.list_my_quizzes()
returns table (
  quiz_id           uuid,
  title             text,
  base_language     text,
  visibility        text,
  video_id          uuid,
  youtube_video_id  text,
  video_title       text,
  channel_name      text,
  transcript_status text,
  question_count    bigint,
  created_at        timestamptz,
  time_restricted   boolean,
  duration_minutes  int,
  duration_seconds  int
)
language sql
security definer
set search_path = public
stable
as $$
  select
    q.id,
    q.title,
    q.base_language,
    q.visibility,
    v.id,
    v.youtube_video_id,
    v.title,
    v.channel_name,
    v.transcript_status,
    (select count(*) from public.questions qs
      where qs.quiz_id = q.id and qs.deleted_at is null),
    q.created_at,
    q.time_restricted,
    q.duration_minutes,
    v.duration_seconds
  from public.quizzes q
  join public.videos v on v.id = q.video_id
  where q.author_id = auth.uid()
    and q.deleted_at is null
  order by q.created_at desc;
$$;

-- ── list_shared_quizzes: gains time_restricted, duration_minutes, duration_seconds
drop function if exists public.list_shared_quizzes();

create or replace function public.list_shared_quizzes()
returns table (
  quiz_id           uuid,
  title             text,
  base_language     text,
  visibility        text,
  video_id          uuid,
  youtube_video_id  text,
  video_title       text,
  channel_name      text,
  transcript_status text,
  question_count    bigint,
  author_id         uuid,
  author_name       text,
  is_own            boolean,
  created_at        timestamptz,
  time_restricted   boolean,
  duration_minutes  int,
  duration_seconds  int
)
language sql
security definer
set search_path = public
stable
as $$
  select
    q.id,
    q.title,
    q.base_language,
    q.visibility,
    v.id,
    v.youtube_video_id,
    v.title,
    v.channel_name,
    v.transcript_status,
    (select count(*) from public.questions qs
      where qs.quiz_id = q.id and qs.deleted_at is null),
    q.author_id,
    p.display_name,
    (q.author_id = auth.uid()),
    q.created_at,
    q.time_restricted,
    q.duration_minutes,
    v.duration_seconds
  from public.quizzes q
  join public.videos   v on v.id = q.video_id
  left join public.profiles p on p.id = q.author_id
  where q.visibility = 'shared'
    and q.deleted_at is null
    and q.school_id = public.current_school_id()
    and public.is_active_teacher()
  order by q.created_at desc;
$$;

-- ── list_student_feed: gains duration_seconds, time_restricted, duration_minutes
-- Bare jsonb, no signature change — plain create or replace.
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
        'title',                q.title,
        'youtube_video_id',    v.youtube_video_id,
        'video_title',         v.title,
        'duration_seconds',    v.duration_seconds,
        'time_restricted',     q.time_restricted,
        'duration_minutes',    q.duration_minutes,
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

revoke all on function public.create_quiz_for_video(text, text, int, text, text, text, boolean, int) from public;
revoke all on function public.update_quiz(uuid, text, text, text, boolean, int)                       from public;
revoke all on function public.get_quiz_for_author(uuid)                                                from public;
revoke all on function public.list_my_quizzes()                                                        from public;
revoke all on function public.list_shared_quizzes()                                                    from public;
revoke all on function public.list_student_feed()                                                      from public;

grant execute on function public.create_quiz_for_video(text, text, int, text, text, text, boolean, int) to authenticated, service_role;
grant execute on function public.update_quiz(uuid, text, text, text, boolean, int)                       to authenticated, service_role;
grant execute on function public.get_quiz_for_author(uuid)                                                to authenticated, service_role;
grant execute on function public.list_my_quizzes()                                                        to authenticated, service_role;
grant execute on function public.list_shared_quizzes()                                                    to authenticated, service_role;
grant execute on function public.list_student_feed()                                                      to authenticated, service_role;

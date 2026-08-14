-- ============================================================
-- videos.channel_name — the uploading channel's display name, shown on the
-- teacher's "my quizzes" cards under the title.
--
-- Fetched via the SAME oEmbed call that already fetches the title (its
-- response includes `author_name`) — no extra network request, and unlike
-- duration_seconds (fetched via the watch-page scrape) this isn't affected by
-- the Epic-0 egress block, so it populates for newly added videos today.
--
-- Follows the exact "never downgrade, backfill on conflict" pattern 125
-- established for title/duration_seconds: a transient oEmbed failure must not
-- permanently blank out a value some other quiz-creation call already
-- recovered, and an existing good value is never overwritten by a later
-- failed fetch.
-- ============================================================

alter table public.videos add column if not exists channel_name text;

drop function if exists public.create_quiz_for_video(text, text, int, text, text);

create or replace function public.create_quiz_for_video(
  p_youtube_id       text,
  p_video_title      text,
  p_duration_seconds int,
  p_base_language    text,
  p_quiz_title       text,
  p_channel_name     text default null
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

  insert into public.quizzes (author_id, video_id, school_id, base_language, title)
  values (auth.uid(), v_video_id, v_school_id, p_base_language, p_quiz_title)
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
    'created_at',        v_quiz.created_at
  );
end;
$$;

-- ── list_my_quizzes: gains channel_name ─────────────────────────────────────
-- `create or replace` cannot change a RETURNS TABLE(...) shape in place
-- (Postgres error 42P13) — must drop first, same as any other RPC whose
-- output/signature changes (see e.g. 128's assign_quiz_to_class).
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
  created_at        timestamptz
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
    q.created_at
  from public.quizzes q
  join public.videos v on v.id = q.video_id
  where q.author_id = auth.uid()
    and q.deleted_at is null
  order by q.created_at desc;
$$;

revoke all on function public.create_quiz_for_video(text, text, int, text, text, text) from public;
revoke all on function public.list_my_quizzes()                                        from public;

grant execute on function public.create_quiz_for_video(text, text, int, text, text, text) to authenticated, service_role;
grant execute on function public.list_my_quizzes()                                        to authenticated, service_role;

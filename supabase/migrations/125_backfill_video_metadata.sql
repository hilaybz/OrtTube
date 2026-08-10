-- ============================================================
-- create_quiz_for_video: backfill null video metadata on conflict
--
-- The video upsert used `ON CONFLICT (youtube_video_id) DO NOTHING`, so only the
-- VERY FIRST quiz ever created on a video set its title/duration_seconds — every
-- later quiz on the same video was a no-op. `title`/`duration_seconds` come from
-- best-effort fetches (oEmbed, a watch-page scrape) that return NULL on any
-- failure, so a single transient failure — a network blip, or YouTube blocking
-- the fetching IP — left the field NULL PERMANENTLY, for every teacher, with no
-- way to recover it from the UI. Same shape as the transcript "no captions"
-- bug fixed earlier: a transient upstream failure recorded as a permanent fact.
--
-- Fix: on conflict, fill only columns that are CURRENTLY NULL. A later quiz on
-- the same video now repairs an earlier gap for free, and existing good data can
-- never be overwritten by a fetch that fails on a subsequent call — the
-- coalesce always prefers what's already stored.
--
-- transcript_status / fetched_at are untouched: they are owned by the transcript
-- cache (`lib/transcriptCache.ts`), never by this RPC.
-- ============================================================

create or replace function public.create_quiz_for_video(
  p_youtube_id       text,
  p_video_title      text,
  p_duration_seconds int,
  p_base_language    text,
  p_quiz_title       text
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
  -- conflict, backfill only whichever of title/duration is currently NULL —
  -- never overwrite a value that is already set.
  insert into public.videos (youtube_video_id, title, duration_seconds)
  values (p_youtube_id, p_video_title, p_duration_seconds)
  on conflict (youtube_video_id) do update
    set title            = coalesce(videos.title, excluded.title),
        duration_seconds = coalesce(videos.duration_seconds, excluded.duration_seconds);

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

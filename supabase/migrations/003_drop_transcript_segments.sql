-- ============================================================
-- Stop storing the raw transcript — only the AI summary is kept.
-- Full transcripts are now fetched live from YouTube when needed
-- for quiz generation, instead of cached in the DB.
-- Run this in: Supabase dashboard → SQL Editor → New query
-- ============================================================

alter table youtube_transcripts drop column segments;

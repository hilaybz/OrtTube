-- ============================================================
-- Video summary for cheap, spoiler-safe Ask-AI context
-- Run this in: Supabase dashboard → SQL Editor → New query
-- ============================================================

alter table youtube_transcripts add column summary text;

create policy "transcripts_public_read" on youtube_transcripts
  for select using (true);

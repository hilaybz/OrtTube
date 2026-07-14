-- ============================================================
-- Transcript cache Storage bucket
-- Range 030–039 (transcripts Storage bucket creation)
-- ============================================================
--
-- One private object per youtube_video_id (`<id>.json`) holding the parsed
-- transcript segments + { lang, kind, fetchedAt } metadata (spec §3.3). The
-- bucket is PRIVATE: it is read/written exclusively by the server via the
-- service-role client (which bypasses RLS), so no anon/authenticated Storage
-- policies are granted here. Supabase Storage has no native object-expiry, so
-- the ~30-day TTL is enforced on read (lib/transcriptCache.ts) and by the
-- orphan-GC / sweep jobs — not by a bucket lifecycle rule.

insert into storage.buckets (id, name, public)
values ('transcripts', 'transcripts', false)
on conflict (id) do nothing;

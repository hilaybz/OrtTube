import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchVideoMetadata } from "./youtube";

/**
 * The canonical, shared `videos` row. Ownerless and deduped by
 * `youtube_video_id`. Typed structurally rather than via the generated
 * `Database` types, so the module depends only on the columns it reads.
 */
export interface VideoRow {
  id: string;
  youtube_video_id: string;
  title: string | null;
  duration_seconds: number | null;
  transcript_status: "pending" | "ready" | "unavailable";
  fetched_at: string | null;
  transcript_fetch_started_at: string | null;
  created_at: string;
}

/**
 * Ensures the canonical `videos` row for `youtubeId` exists and returns it.
 *
 * Fetches real metadata, then upserts with `ON CONFLICT (youtube_video_id) DO
 * NOTHING` (via `ignoreDuplicates`) so a concurrent creator or a previously
 * created row is **never** downgraded — existing title/duration/status are left
 * untouched. Re-selects afterwards to return the authoritative row.
 *
 * Requires a **service-role** client (shared `videos` writes bypass RLS). Quiz
 * authoring composes this inside its atomic "create video + first quiz" RPC/txn;
 * standalone it is safe but not itself transactional with quiz creation.
 */
export async function ensureVideo(
  client: SupabaseClient,
  youtubeId: string
): Promise<VideoRow> {
  const meta = await fetchVideoMetadata(youtubeId);

  const { error: upsertError } = await client.from("videos").upsert(
    {
      youtube_video_id: youtubeId,
      title: meta.title,
      duration_seconds: meta.durationSeconds,
    },
    { onConflict: "youtube_video_id", ignoreDuplicates: true }
  );
  if (upsertError) {
    throw new Error(`ensureVideo: upsert failed for ${youtubeId}: ${upsertError.message}`);
  }

  const { data, error } = await client
    .from("videos")
    .select(
      "id, youtube_video_id, title, duration_seconds, transcript_status, fetched_at, transcript_fetch_started_at, created_at"
    )
    .eq("youtube_video_id", youtubeId)
    .single();

  if (error || !data) {
    throw new Error(
      `ensureVideo: re-select failed for ${youtubeId}: ${error?.message ?? "no row"}`
    );
  }
  return data as VideoRow;
}

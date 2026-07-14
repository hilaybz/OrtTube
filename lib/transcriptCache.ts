import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFreshTranscript, type TranscriptSegment } from "./transcript";

/** Content freshness TTL: re-fetch a transcript older than ~30 days. */
const CONTENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Single-flight claim timeout. The claim marker (`videos.transcript_fetch_
 * started_at`) is considered stale after this window so a crashed/abandoned
 * fetch cannot block re-fetching for the full content TTL. Kept well above a
 * realistic fetch duration (long external I/O) but far below CONTENT_TTL.
 */
const CLAIM_TTL_MS = 10 * 60 * 1000;

/** Storage bucket holding one JSON transcript object per youtube_video_id. */
export const TRANSCRIPT_BUCKET = process.env.TRANSCRIPT_BUCKET || "transcripts";

/** Shape of the cached Storage object. `fetchedAt` here is descriptive only —
 * `videos.fetched_at` is the single authoritative freshness source. */
interface CachedTranscript {
  youtubeVideoId: string;
  segments: TranscriptSegment[];
  language: string | null;
  kind: string;
  fetchedAt: string;
}

export interface TranscriptResult {
  segments: TranscriptSegment[];
  language: string | null;
}

interface VideoFreshnessRow {
  transcript_status: "pending" | "ready" | "unavailable";
  fetched_at: string | null;
}

function objectPath(youtubeId: string): string {
  return `${youtubeId}.json`;
}

/** Freshness is decided solely from `videos.fetched_at` + status (one source). */
function isFresh(video: VideoFreshnessRow | null): boolean {
  if (!video || video.transcript_status !== "ready" || !video.fetched_at) return false;
  const age = Date.now() - new Date(video.fetched_at).getTime();
  return age >= 0 && age < CONTENT_TTL_MS;
}

async function readVideo(
  client: SupabaseClient,
  youtubeId: string
): Promise<VideoFreshnessRow | null> {
  const { data } = await client
    .from("videos")
    .select("transcript_status, fetched_at")
    .eq("youtube_video_id", youtubeId)
    .maybeSingle();
  return (data as VideoFreshnessRow | null) ?? null;
}

async function readCached(
  client: SupabaseClient,
  youtubeId: string
): Promise<CachedTranscript | null> {
  const { data, error } = await client.storage
    .from(TRANSCRIPT_BUCKET)
    .download(objectPath(youtubeId));
  if (error || !data) return null;
  try {
    const parsed = JSON.parse(await data.text()) as CachedTranscript;
    if (!Array.isArray(parsed.segments)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCached(
  client: SupabaseClient,
  youtubeId: string,
  payload: { segments: TranscriptSegment[]; language: string | null; kind: string }
): Promise<void> {
  const body: CachedTranscript = {
    youtubeVideoId: youtubeId,
    segments: payload.segments,
    language: payload.language,
    kind: payload.kind,
    fetchedAt: new Date().toISOString(),
  };
  await client.storage
    .from(TRANSCRIPT_BUCKET)
    .upload(objectPath(youtubeId), JSON.stringify(body), {
      upsert: true,
      contentType: "application/json",
    });
}

/**
 * Atomically claims the single-flight fetch slot for `youtubeId`.
 *
 * Compiles to one `UPDATE videos SET transcript_fetch_started_at = now() WHERE
 * youtube_video_id = $1 AND (transcript_fetch_started_at IS NULL OR
 * transcript_fetch_started_at < now() - CLAIM_TTL) RETURNING id`. Because it is
 * a single statement, Postgres row-locking guarantees exactly one concurrent
 * caller sees the marker as claimable; the marker (not a session advisory lock)
 * is used so we never hold a DB lock across the long external fetch, which is
 * unsafe under the transaction-mode pooler.
 *
 * Returns true for the winner, false for losers.
 */
async function claimFetch(client: SupabaseClient, youtubeId: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const claimCutoff = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
  const { data, error } = await client
    .from("videos")
    .update({ transcript_fetch_started_at: nowIso })
    .eq("youtube_video_id", youtubeId)
    .or(`transcript_fetch_started_at.is.null,transcript_fetch_started_at.lt.${claimCutoff}`)
    .select("id");
  return !error && Array.isArray(data) && data.length > 0;
}

/** Marks a confirmed transcript ready and clears the claim marker. */
async function markReady(client: SupabaseClient, youtubeId: string): Promise<void> {
  await client
    .from("videos")
    .update({
      transcript_status: "ready",
      fetched_at: new Date().toISOString(),
      transcript_fetch_started_at: null,
    })
    .eq("youtube_video_id", youtubeId);
}

/** Marks a confirmed no-captions video unavailable and clears the claim marker. */
async function markUnavailable(client: SupabaseClient, youtubeId: string): Promise<void> {
  await client
    .from("videos")
    .update({
      transcript_status: "unavailable",
      fetched_at: new Date().toISOString(),
      transcript_fetch_started_at: null,
    })
    .eq("youtube_video_id", youtubeId);
}

/**
 * Clears only the claim marker WITHOUT touching status/fetched_at. Used after a
 * transient failure so a working `ready` status is never downgraded
 * while still releasing the single-flight slot for a later retry.
 */
async function clearMarker(client: SupabaseClient, youtubeId: string): Promise<void> {
  await client
    .from("videos")
    .update({ transcript_fetch_started_at: null })
    .eq("youtube_video_id", youtubeId);
}

/**
 * Returns the cached transcript for a canonical video, re-fetching from YouTube
 * when the Storage object is missing or `videos.fetched_at` is older than the
 * ~30-day TTL.
 *
 * Concurrency: a single-flight claim marker ensures only one concurrent reader
 * of a stale/missing object re-fetches; losers serve the stale object (or fall
 * back to null) rather than blocking or double-fetching. Status semantics: a
 * confirmed transcript → `ready`; a confirmed no-captions video → `unavailable`;
 * a transient/empty failure never downgrades an existing `ready`.
 *
 * The `videos` row must already exist (created by `ensureVideo` / the atomic
 * create); if it does not, this returns whatever is cached or null and does not
 * fetch (there is nothing to claim against).
 *
 * Requires a **service-role** client (writes the shared `videos` row + Storage).
 */
export async function getTranscript(
  client: SupabaseClient,
  youtubeId: string
): Promise<TranscriptResult | null> {
  const video = await readVideo(client, youtubeId);
  const cached = await readCached(client, youtubeId);

  if (isFresh(video) && cached) {
    return { segments: cached.segments, language: cached.language };
  }

  // No canonical row → nothing to claim against; serve stale cache if any.
  if (!video) {
    return cached ? { segments: cached.segments, language: cached.language } : null;
  }

  const won = await claimFetch(client, youtubeId);
  if (!won) {
    // Loser: serve the stale object (or fall back) instead of double-fetching.
    return cached ? { segments: cached.segments, language: cached.language } : null;
  }

  try {
    const outcome = await fetchFreshTranscript(youtubeId);

    if (outcome.status === "ok") {
      await writeCached(client, youtubeId, {
        segments: outcome.segments,
        language: outcome.language,
        kind: outcome.kind,
      });
      await markReady(client, youtubeId);
      return { segments: outcome.segments, language: outcome.language };
    }

    if (outcome.status === "unavailable") {
      await markUnavailable(client, youtubeId);
      return null;
    }

    // Transient failure: release the slot, keep status/fetched_at untouched.
    await clearMarker(client, youtubeId);
    return cached ? { segments: cached.segments, language: cached.language } : null;
  } catch {
    await clearMarker(client, youtubeId);
    return cached ? { segments: cached.segments, language: cached.language } : null;
  }
}

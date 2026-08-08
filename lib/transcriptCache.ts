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

/**
 * NEGATIVE cache TTL: how long a "no usable captions" verdict is trusted before
 * we look again. A verdict is a judgement made at a point in time, not a
 * permanent property of the video — creators do add captions later, and a fetch
 * that was blocked rather than genuinely empty must not strand the video
 * forever. Long enough that re-checking costs almost nothing; short enough that
 * captions added to a video in active use are picked up within days.
 */
const NEGATIVE_TTL_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Claim window for an EXPLICIT retry (a teacher pressing "generate"). A failed
 * attempt deliberately leaves its claim marker in place, which throttles the
 * automatic callers — but a human who just watched it fail should get a real
 * attempt rather than a silent no-op, so their claim only has to beat a short
 * floor. Two rapid clicks still collapse into one upstream fetch.
 */
const FORCE_CLAIM_TTL_MS = 30 * 1000;

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

/**
 * Records a non-success fetch outcome to the platform log.
 *
 * The failures that matter happen on production egress IPs and cannot be
 * reproduced locally, which is exactly why `fetchFreshTranscript` bothers to
 * compute a reason code — but nothing used to read it, so every distinct cause
 * (bot check, login wall, rate limit, genuinely caption-less video) surfaced to
 * the teacher as one indistinguishable 409 and left no trace. `youtube_video_id`
 * is included because the canonical video row is shared across schools, so it is
 * the only handle that ties a log line back to a specific video.
 */
function log(youtubeId: string, outcome: string): void {
  console.warn(`[transcript] video=${youtubeId} ${outcome}`);
}

/** Freshness is decided solely from `videos.fetched_at` + status (one source). */
function isFresh(video: VideoFreshnessRow | null): boolean {
  if (!video || video.transcript_status !== "ready" || !video.fetched_at) return false;
  const age = Date.now() - new Date(video.fetched_at).getTime();
  return age >= 0 && age < CONTENT_TTL_MS;
}

/**
 * Whether a recent "no usable captions" verdict should be trusted instead of
 * asking YouTube again.
 *
 * This is what stops a caption-less video costing one upstream request per
 * caller: the AI tutor calls `getTranscript` on EVERY student question, so
 * without a negative cache a single such video in a class turns into a request
 * per question — wasteful, and the surest way to deepen an IP block.
 */
function isNegativeFresh(video: VideoFreshnessRow | null): boolean {
  if (!video || video.transcript_status !== "unavailable" || !video.fetched_at) {
    return false;
  }
  const age = Date.now() - new Date(video.fetched_at).getTime();
  return age >= 0 && age < NEGATIVE_TTL_MS;
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
async function claimFetch(
  client: SupabaseClient,
  youtubeId: string,
  claimTtlMs: number = CLAIM_TTL_MS
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const claimCutoff = new Date(Date.now() - claimTtlMs).toISOString();
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

// (A `clearMarker` helper lived here. A transient failure now intentionally
// leaves the claim marker set so it throttles automatic retries until the claim
// TTL expires, so nothing clears it early any more. `markReady` /
// `markUnavailable` clear it as part of recording their verdict.)

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
 * A recent `unavailable` verdict is trusted for `NEGATIVE_TTL_MS` and short-
 * circuits without an upstream call — see `isNegativeFresh`. Pass
 * `{ force: true }` for an EXPLICIT human retry (a teacher pressing "generate"),
 * which ignores that verdict and only has to beat a 30s floor. Automatic callers
 * — notably the AI tutor, which runs per student question — must leave it
 * `false` so they stay throttled.
 *
 * Requires a **service-role** client (writes the shared `videos` row + Storage).
 */
export async function getTranscript(
  client: SupabaseClient,
  youtubeId: string,
  opts: { force?: boolean } = {}
): Promise<TranscriptResult | null> {
  const force = opts.force === true;
  const video = await readVideo(client, youtubeId);
  const cached = await readCached(client, youtubeId);

  if (isFresh(video) && cached) {
    return { segments: cached.segments, language: cached.language };
  }

  // No canonical row → nothing to claim against; serve stale cache if any.
  if (!video) {
    return cached ? { segments: cached.segments, language: cached.language } : null;
  }

  // A recent "no usable captions" verdict stands, unless a human explicitly
  // asked again. Without this the tutor re-fetches on every student question.
  if (!force && isNegativeFresh(video)) {
    return cached ? { segments: cached.segments, language: cached.language } : null;
  }

  const won = await claimFetch(
    client,
    youtubeId,
    force ? FORCE_CLAIM_TTL_MS : CLAIM_TTL_MS
  );
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
      log(youtubeId, "confirmed no usable captions (page intact and playable)");
      await markUnavailable(client, youtubeId);
      return null;
    }

    // Transient failure. Status/fetched_at stay untouched so a working `ready` is
    // never downgraded — but the claim marker is deliberately LEFT IN PLACE. It
    // doubles as the negative cache for this case: `unavailable` has fetched_at
    // to age against, a transient failure has nothing, and the marker already
    // carries a timestamp with a TTL. Automatic callers are therefore throttled
    // for CLAIM_TTL_MS, while an explicit retry only has to beat the 30s force
    // floor. A crashed fetch self-heals on the same expiry, exactly as before.
    log(
      youtubeId,
      `transient failure reason=${outcome.reason} served_stale=${cached ? "yes" : "no"}`
    );
    return cached ? { segments: cached.segments, language: cached.language } : null;
  } catch (e) {
    log(youtubeId, `threw: ${e instanceof Error ? e.message : String(e)}`);
    return cached ? { segments: cached.segments, language: cached.language } : null;
  }
}

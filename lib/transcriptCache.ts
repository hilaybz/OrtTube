import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFreshTranscript, type TranscriptSegment } from "./transcript";

const CONTENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * NEGATIVE cache TTL: how long a "no usable captions" verdict is trusted before
 * we look again. A verdict is a judgement made at a point in time, not a
 * permanent property of the video — creators do add captions later, and a fetch
 * that was blocked rather than genuinely empty must not strand the video
 * forever. Long enough that re-checking costs almost nothing; short enough that
 * captions added to a video in active use are picked up within days.
 */
const NEGATIVE_TTL_MS = 2 * 24 * 60 * 60 * 1000;

export const TRANSCRIPT_BUCKET = process.env.TRANSCRIPT_BUCKET || "transcripts";

/** Shape of the cached Storage object. `fetchedAt` here is descriptive only —
 * `videos.fetched_at` is the single authoritative freshness source. */
interface CachedTranscript {
  youtubeVideoId: string;
  segments: TranscriptSegment[];
  language: string | null;
  fetchedAt: string;
}

/**
 * `unavailable` is the ONLY member that says anything about the video itself.
 */
export type TranscriptOutcome =
  | { state: "ready"; segments: TranscriptSegment[]; language: string | null }
  | { state: "unavailable" }
  | { state: "throttled" }
  /** We tried and could not read it. Says nothing about whether captions exist. */
  | { state: "failed"; reason: string };

interface VideoFreshnessRow {
  transcript_status: "pending" | "ready" | "unavailable";
  fetched_at: string | null;
}

function objectPath(youtubeId: string): string {
  return `${youtubeId}.json`;
}

function log(youtubeId: string, outcome: string, trace?: string[]): void {
  console.warn(`[transcript] video=${youtubeId} ${outcome}`);
  if (trace?.length) {
    console.warn(`[transcript] video=${youtubeId} trace:\n  ${trace.join("\n  ")}`);
  }
}

function isFresh(video: VideoFreshnessRow | null): boolean {
  if (!video || video.transcript_status !== "ready" || !video.fetched_at) return false;
  const age = Date.now() - new Date(video.fetched_at).getTime();
  return age >= 0 && age < CONTENT_TTL_MS;
}

/**
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
  payload: { segments: TranscriptSegment[]; language: string | null }
): Promise<void> {
  const body: CachedTranscript = {
    youtubeVideoId: youtubeId,
    segments: payload.segments,
    language: payload.language,
    fetchedAt: new Date().toISOString(),
  };
  await client.storage
    .from(TRANSCRIPT_BUCKET)
    .upload(objectPath(youtubeId), JSON.stringify(body), {
      upsert: true,
      contentType: "application/json",
    });
}

async function markReady(client: SupabaseClient, youtubeId: string): Promise<void> {
  await client
    .from("videos")
    .update({ transcript_status: "ready", fetched_at: new Date().toISOString() })
    .eq("youtube_video_id", youtubeId);
}

async function markUnavailable(client: SupabaseClient, youtubeId: string): Promise<void> {
  await client
    .from("videos")
    .update({ transcript_status: "unavailable", fetched_at: new Date().toISOString() })
    .eq("youtube_video_id", youtubeId);
}

/**
 * A promise map is weaker (two Vercel instances still fetch twice) and better:
 * joining a promise cannot fail, cannot lie, and cannot be stolen. Duplicate
 * fetches across instances are a bandwidth cost we accept; false "this video has
 * no captions" shown to a teacher is not.
 */
const inFlight = new Map<string, Promise<TranscriptOutcome>>();

/**
 * Only a confirmed `ready` result is memoized, never a stale fallback or a
 * failure, so a degraded answer cannot outlive the row-level TTLs. Bounded by
 * entry count; insertion order is recency order, so the first key is the one to
 * evict.
 */
const MEMORY_TTL_MS = 3 * 60 * 1000;
const MEMORY_MAX_ENTRIES = 20;

const memory = new Map<
  string,
  { expiresAt: number; segments: TranscriptSegment[]; language: string | null }
>();

function memoryGet(youtubeId: string): TranscriptOutcome | null {
  const hit = memory.get(youtubeId);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    memory.delete(youtubeId);
    return null;
  }
  memory.delete(youtubeId);
  memory.set(youtubeId, hit);
  return { state: "ready", segments: hit.segments, language: hit.language };
}

function memorySet(youtubeId: string, outcome: TranscriptOutcome): void {
  if (outcome.state !== "ready") return;
  memory.delete(youtubeId);
  memory.set(youtubeId, {
    expiresAt: Date.now() + MEMORY_TTL_MS,
    segments: outcome.segments,
    language: outcome.language,
  });
  while (memory.size > MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next();
    if (oldest.done) break;
    memory.delete(oldest.value);
  }
}

export function resetTranscriptMemoryCache(): void {
  memory.clear();
}

/**
 * Runs the upstream fetch and records its verdict. Never rejects — a throw here
 * would reject every joined caller, and the whole point of sharing is that a
 * joiner is no worse off than the caller that started it.
 */
async function fetchAndRecord(
  client: SupabaseClient,
  youtubeId: string
): Promise<TranscriptOutcome> {
  try {
    const outcome = await fetchFreshTranscript(youtubeId);

    if (outcome.status === "ok") {
      await writeCached(client, youtubeId, {
        segments: outcome.segments,
        language: outcome.language,
      });
      await markReady(client, youtubeId);
      return { state: "ready", segments: outcome.segments, language: outcome.language };
    }

    if (outcome.status === "unavailable") {
      // Traced as well as logged: this verdict is sticky for two days and applies
      // to every school, so it has to stay auditable after the fact.
      log(
        youtubeId,
        "confirmed no usable captions (player intact and playable)",
        outcome.trace
      );
      await markUnavailable(client, youtubeId);
      return { state: "unavailable" };
    }

    // Transient. `transcript_status` / `fetched_at` stay untouched so a working
    // `ready` is never downgraded by a fetch that merely failed to reach YouTube.
    log(youtubeId, `transient failure reason=${outcome.reason}`, outcome.trace);
    return { state: "failed", reason: outcome.reason };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    log(youtubeId, `threw: ${reason}`);
    return { state: "failed", reason };
  }
}

function sharedFetch(
  client: SupabaseClient,
  youtubeId: string
): Promise<TranscriptOutcome> {
  const existing = inFlight.get(youtubeId);
  if (existing) return existing;
  const started = fetchAndRecord(client, youtubeId).finally(() => {
    inFlight.delete(youtubeId);
  });
  inFlight.set(youtubeId, started);
  return started;
}

function readyFrom(cached: CachedTranscript): TranscriptOutcome {
  return { state: "ready", segments: cached.segments, language: cached.language };
}

/**
 * Returns the transcript for a canonical video, fetching from YouTube when the
 * Storage object is missing or `videos.fetched_at` is older than the ~30-day TTL.
 *
 * Status semantics: a confirmed transcript → `ready`; a confirmed no-captions
 * video → `unavailable`; a transient failure → `failed`, which never downgrades
 * an existing `ready` and serves the stale object if there is one.
 *
 * The `videos` row must already exist (created by `create_video_and_quiz`); if it
 * does not, this serves whatever is cached and does not fetch.
 *
 * A recent `unavailable` verdict is trusted for `NEGATIVE_TTL_MS` and short-
 * circuits without an upstream call. Pass `{ force: true }` for an EXPLICIT human
 * retry (a teacher pressing "generate") to ignore it. Automatic callers — notably
 * the tutor, which runs per student question — must leave it `false`.
 *
 * Requires a **service-role** client (writes the shared `videos` row + Storage).
 */
export async function getTranscript(
  client: SupabaseClient,
  youtubeId: string,
  opts: { force?: boolean } = {}
): Promise<TranscriptOutcome> {
  const force = opts.force === true;

  if (force) {
    memory.delete(youtubeId);
  } else {
    const remembered = memoryGet(youtubeId);
    if (remembered) return remembered;
  }

  const video = await readVideo(client, youtubeId);

  // Storage is only read once a decision needs it. Reading it up front cost a
  // full object download on every tutor question and on every negative-cache hit,
  // to use ~8KB of it or none at all.
  if (isFresh(video)) {
    const cached = await readCached(client, youtubeId);
    if (cached) {
      const outcome = readyFrom(cached);
      memorySet(youtubeId, outcome);
      return outcome;
    }
  }

  if (!video) {
    const cached = await readCached(client, youtubeId);
    return cached ? readyFrom(cached) : { state: "failed", reason: "no_video_row" };
  }

  // A recent "no usable captions" verdict stands, unless a human explicitly asked
  // again. Without this the tutor re-fetches on every student question.
  if (!force && isNegativeFresh(video)) {
    const cached = await readCached(client, youtubeId);
    if (cached) return readyFrom(cached);
    return { state: "throttled" };
  }

  const outcome = await sharedFetch(client, youtubeId);
  memorySet(youtubeId, outcome);

  // A failed refresh must not lose a transcript we already hold.
  if (outcome.state === "failed") {
    const cached = await readCached(client, youtubeId);
    if (cached) return readyFrom(cached);
  }
  return outcome;
}

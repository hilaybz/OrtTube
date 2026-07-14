/**
 * Videos integration tests — transcript Storage cache, single-flight, TTL, and
 * status semantics (spec §3.3).
 *
 * `fetchFreshTranscript` (the YouTube scrape) is mocked so no network I/O runs;
 * everything else exercises the REAL local Supabase stack — the `videos` claim
 * marker (atomic single-flight UPDATE) and the `transcripts` Storage bucket.
 *
 * The actor DSL in `test/helpers/testbed` has no video/transcript vocabulary
 * (it models schools/teachers/students/quizzes, not the cache), so this suite
 * keeps a small, local `pg`/Storage harness with intention-revealing names:
 *   • `givenVideo`        — seed a `videos` row in a known transcript state.
 *   • `youtubeReturnsTrack` / `youtubeReturns` — script the mocked scraper.
 *   • `cachedTranscript`  — read back the Storage object.
 *   • `videoState`        — read back the row's status + claim fields.
 *
 * Runs at the integration/gate step (which owns DB application). Skipped when the
 * local DB is unreachable so unit suites still pass without Supabase running.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { getTranscript, TRANSCRIPT_BUCKET } from "@/lib/transcriptCache";
import { fetchFreshTranscript, type FetchOutcome } from "@/lib/transcript";
import { resetDb, getPool, closePool, getServiceClient } from "../helpers/db";

vi.mock("@/lib/transcript", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/transcript")>();
  return { ...actual, fetchFreshTranscript: vi.fn() };
});

const scraper = vi.mocked(fetchFreshTranscript);

const HEBREW_SEGMENTS = [
  { text: "shalom", offset: 0, duration: 1000 },
  { text: "olam", offset: 1000, duration: 1000 },
];

/** A manual (human-authored) Hebrew caption track — the common happy-path fetch. */
function manualHebrewTrack(): FetchOutcome {
  return { status: "ok", segments: HEBREW_SEGMENTS, language: "he", kind: "manual" };
}

/** Script the mocked scraper to return one fixed outcome. */
function youtubeReturns(outcome: FetchOutcome): void {
  scraper.mockResolvedValue(outcome);
}

/** Seed a `videos` row for `youtubeId` in a known transcript state. */
async function givenVideo(
  youtubeId: string,
  state: { status?: string; fetchedAt?: string | null; claim?: string | null } = {}
): Promise<void> {
  await getPool().query(
    `INSERT INTO public.videos
       (youtube_video_id, transcript_status, fetched_at, transcript_fetch_started_at)
     VALUES ($1, $2, $3, $4)`,
    [youtubeId, state.status ?? "pending", state.fetchedAt ?? null, state.claim ?? null]
  );
}

/** The stored transcript-cache bookkeeping for a video. */
async function videoState(youtubeId: string) {
  const { rows } = await getPool().query(
    "SELECT transcript_status, fetched_at, transcript_fetch_started_at FROM public.videos WHERE youtube_video_id = $1",
    [youtubeId]
  );
  return rows[0];
}

/** Remove any cached Storage object for a video (test isolation). */
async function clearCachedTranscript(youtubeId: string): Promise<void> {
  await getServiceClient().storage.from(TRANSCRIPT_BUCKET).remove([`${youtubeId}.json`]);
}

/** The cached transcript object in Storage, or null if none is cached. */
async function cachedTranscript(youtubeId: string): Promise<{
  segments: unknown[];
  language: string | null;
  kind: string;
} | null> {
  const { data } = await getServiceClient()
    .storage.from(TRANSCRIPT_BUCKET)
    .download(`${youtubeId}.json`);
  if (!data) return null;
  return JSON.parse(await data.text());
}

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

const online = await dbReachable();

describe.skipIf(!online)("getTranscript (transcript cache)", () => {
  beforeEach(async () => {
    await resetDb();
    scraper.mockReset();
  });

  afterAll(async () => {
    await closePool();
  });

  it("re-fetches on cache miss, caches the manual track in its original language, and sets status=ready", async () => {
    const youtubeId = "manual00001";
    await clearCachedTranscript(youtubeId);
    await givenVideo(youtubeId, { status: "pending" });
    youtubeReturns(manualHebrewTrack());

    const result = await getTranscript(getServiceClient(), youtubeId);

    expect(result?.language).toBe("he");
    expect(result?.segments).toHaveLength(2);

    const cached = await cachedTranscript(youtubeId);
    expect(cached?.language).toBe("he");
    expect(cached?.kind).not.toBe("asr"); // manual track cached
    expect(cached?.segments).toHaveLength(2);

    const state = await videoState(youtubeId);
    expect(state.transcript_status).toBe("ready");
    expect(state.fetched_at).not.toBeNull();
    expect(state.transcript_fetch_started_at).toBeNull(); // claim cleared
  });

  it("marks a captions-less video 'unavailable' and returns null", async () => {
    const youtubeId = "nocaps00001";
    await clearCachedTranscript(youtubeId);
    await givenVideo(youtubeId, { status: "pending" });
    youtubeReturns({ status: "unavailable" });

    const result = await getTranscript(getServiceClient(), youtubeId);

    expect(result).toBeNull();
    const state = await videoState(youtubeId);
    expect(state.transcript_status).toBe("unavailable");
    expect(state.transcript_fetch_started_at).toBeNull();
  });

  it("does NOT downgrade a 'ready' video on a transient failure", async () => {
    const youtubeId = "ready000001";
    const fetchedLongAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40d old
    await clearCachedTranscript(youtubeId);
    await givenVideo(youtubeId, { status: "ready", fetchedAt: fetchedLongAgo });
    youtubeReturns({ status: "error" });

    const result = await getTranscript(getServiceClient(), youtubeId);

    expect(result).toBeNull(); // no cached object to serve
    const state = await videoState(youtubeId);
    expect(state.transcript_status).toBe("ready"); // preserved
    expect(state.transcript_fetch_started_at).toBeNull(); // claim released for retry
  });

  it("single-flights concurrent readers of a stale video (fetch runs once)", async () => {
    const youtubeId = "concur00001";
    await clearCachedTranscript(youtubeId);
    await givenVideo(youtubeId, { status: "pending" });
    scraper.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return manualHebrewTrack();
    });

    const [firstReader, secondReader] = await Promise.all([
      getTranscript(getServiceClient(), youtubeId),
      getTranscript(getServiceClient(), youtubeId),
    ]);

    expect(scraper).toHaveBeenCalledTimes(1); // loser did not double-fetch
    // At least one caller gets the transcript; neither triggered a second fetch.
    expect([firstReader, secondReader].some((r) => r?.segments.length === 2)).toBe(true);
  });

  it("serves a fresh cached object without re-fetching", async () => {
    const youtubeId = "fresh000001";
    await clearCachedTranscript(youtubeId);
    // Prime the cache: first fetch populates Storage + sets fetched_at=now.
    await givenVideo(youtubeId, { status: "pending" });
    youtubeReturns(manualHebrewTrack());
    await getTranscript(getServiceClient(), youtubeId);
    expect(scraper).toHaveBeenCalledTimes(1);

    // Second read is fresh (fetched_at just set) → cache hit, no new fetch.
    scraper.mockClear();
    const result = await getTranscript(getServiceClient(), youtubeId);
    expect(scraper).not.toHaveBeenCalled();
    expect(result?.language).toBe("he");
    expect(result?.segments).toHaveLength(2);
  });
});

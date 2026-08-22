/**
 * Videos integration tests — transcript Storage cache, single-flight, TTL, and
 * status semantics (spec §3.3).
 *
 * `fetchFreshTranscript` (the YouTube scrape) is mocked so no network I/O runs;
 * everything else exercises the REAL local Supabase stack — the `videos`
 * marker (atomic single-flight UPDATE) and the `transcripts` Storage bucket.
 *
 * The actor DSL in `test/helpers/testbed` has no video/transcript vocabulary
 * (it models schools/teachers/students/quizzes, not the cache), so this suite
 * keeps a small, local `pg`/Storage harness with intention-revealing names:
 *   • `givenVideo`        — seed a `videos` row in a known transcript state.
 *   • `youtubeReturnsTrack` / `youtubeReturns` — script the mocked scraper.
 *   • `cachedTranscript`  — read back the Storage object.
 *   • `videoState`        — read back the row's transcript state.
 *
 * Runs at the integration/gate step (which owns DB application). Skipped when the
 * local DB is unreachable so unit suites still pass without Supabase running.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  getTranscript,
  TRANSCRIPT_BUCKET,
  type TranscriptOutcome,
} from "@/lib/transcriptCache";
import { fetchFreshTranscript, type FetchOutcome } from "@/lib/transcript";
import { resetDb, getPool, closePool, getServiceClient } from "../helpers/db";
import { stackOnline } from "../helpers/stack";

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
  return {
    status: "ok",
    segments: HEBREW_SEGMENTS,
    language: "he",
    trace: [],
  };
}

/** Narrows to the `ready` outcome, or null — so a test asserting on segments
 * fails loudly rather than reading them off a verdict that carries none. */
function ready(
  outcome: TranscriptOutcome
): Extract<TranscriptOutcome, { state: "ready" }> | null {
  return outcome.state === "ready" ? outcome : null;
}

/** Script the mocked scraper to return one fixed outcome. These tests are about
 * what the CACHE does with an outcome, so the trace stays empty throughout —
 * what a real fetch records in it is pinned in transcriptClassify.unit.test.ts. */
function youtubeReturns(outcome: FetchOutcome): void {
  scraper.mockResolvedValue(outcome);
}

/** Seed a `videos` row for `youtubeId` in a known transcript state. */
async function givenVideo(
  youtubeId: string,
  state: { status?: string; fetchedAt?: string | null } = {}
): Promise<void> {
  await getPool().query(
    `INSERT INTO public.videos (youtube_video_id, transcript_status, fetched_at)
     VALUES ($1, $2, $3)`,
    [youtubeId, state.status ?? "pending", state.fetchedAt ?? null]
  );
}

/** The stored transcript-cache bookkeeping for a video. */
async function videoState(youtubeId: string) {
  const { rows } = await getPool().query(
    "SELECT transcript_status, fetched_at FROM public.videos WHERE youtube_video_id = $1",
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
} | null> {
  const { data } = await getServiceClient()
    .storage.from(TRANSCRIPT_BUCKET)
    .download(`${youtubeId}.json`);
  if (!data) return null;
  return JSON.parse(await data.text());
}


const online = await stackOnline();

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

    expect(ready(result)?.language).toBe("he");
    expect(ready(result)?.segments).toHaveLength(2);

    const cached = await cachedTranscript(youtubeId);
    expect(cached?.language).toBe("he");
    expect(cached?.segments).toHaveLength(2);

    const state = await videoState(youtubeId);
    expect(state.transcript_status).toBe("ready");
    expect(state.fetched_at).not.toBeNull();
  });

  it("marks a captions-less video 'unavailable' and reports it as a verdict", async () => {
    const youtubeId = "nocaps00001";
    await clearCachedTranscript(youtubeId);
    await givenVideo(youtubeId, { status: "pending" });
    youtubeReturns({ status: "unavailable", trace: [] });

    const result = await getTranscript(getServiceClient(), youtubeId);

    expect(result.state).toBe("unavailable");
    const state = await videoState(youtubeId);
    expect(state.transcript_status).toBe("unavailable");
  });

  it("does NOT downgrade a 'ready' video on a transient failure", async () => {
    const youtubeId = "ready000001";
    const fetchedLongAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40d old
    await clearCachedTranscript(youtubeId);
    await givenVideo(youtubeId, { status: "ready", fetchedAt: fetchedLongAgo });
    youtubeReturns({ status: "error", reason: "player_not_loaded:http_429", trace: [] });

    const result = await getTranscript(getServiceClient(), youtubeId);

    // `failed`, never `unavailable`: the fetch says nothing about whether this
    // video has captions, and reporting it as a verdict is what stranded videos.
    expect(result.state).toBe("failed");
    const state = await videoState(youtubeId);
    expect(state.transcript_status).toBe("ready"); // preserved
    // fetched_at must not move either: touching it would make a 40-day-old
    // transcript look freshly confirmed on the strength of a fetch that failed.
    expect(new Date(state.fetched_at).toISOString()).toBe(fetchedLongAgo);
  });

  it("does not re-fetch an 'unavailable' video while the negative verdict is fresh", async () => {
    // The regression that matters most: the tutor calls getTranscript on EVERY
    // student question, so a caption-less video used to cost one YouTube request
    // per question.
    const youtubeId = "negcache001";
    await clearCachedTranscript(youtubeId);
    await givenVideo(youtubeId, {
      status: "unavailable",
      fetchedAt: new Date().toISOString(),
    });
    youtubeReturns({ status: "unavailable", trace: [] });

    await getTranscript(getServiceClient(), youtubeId);
    await getTranscript(getServiceClient(), youtubeId);
    await getTranscript(getServiceClient(), youtubeId);

    expect(scraper).not.toHaveBeenCalled();
  });

  it("re-checks an 'unavailable' video once the verdict has expired", async () => {
    // A verdict is a judgement at a point in time, not a permanent property:
    // captions get added, and the fetch may have been blocked rather than empty.
    const youtubeId = "negstale001";
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await clearCachedTranscript(youtubeId);
    await givenVideo(youtubeId, { status: "unavailable", fetchedAt: threeDaysAgo });
    youtubeReturns(manualHebrewTrack());

    const result = await getTranscript(getServiceClient(), youtubeId);

    expect(scraper).toHaveBeenCalledTimes(1);
    expect(ready(result)?.segments).toHaveLength(2);
    expect((await videoState(youtubeId)).transcript_status).toBe("ready");
  });

  it("force re-checks an 'unavailable' video even while the verdict is fresh", async () => {
    // A teacher pressing "generate" is an explicit human retry — it must do
    // something, or the button looks broken exactly as it did before this fix.
    const youtubeId = "negforce001";
    await clearCachedTranscript(youtubeId);
    await givenVideo(youtubeId, {
      status: "unavailable",
      fetchedAt: new Date().toISOString(),
    });
    youtubeReturns(manualHebrewTrack());

    const result = await getTranscript(getServiceClient(), youtubeId, { force: true });

    expect(scraper).toHaveBeenCalledTimes(1);
    expect(ready(result)?.segments).toHaveLength(2);
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
    expect([firstReader, secondReader].some((r) => ready(r)?.segments.length === 2)).toBe(true);
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
    expect(ready(result)?.language).toBe("he");
    expect(ready(result)?.segments).toHaveLength(2);
  });
});

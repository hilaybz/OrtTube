/**
 * `getTranscript` outcomes — no DB, no Docker, no network.
 *
 * These exist because this function had no unit tests at all. Its only coverage
 * was `transcriptCache.int.test.ts`, which skips without a local Supabase stack —
 * the default state for a developer and for CI — so a normal `npm test` verified
 * none of it. That is how a change that inverted single-flight, and a route that
 * reported a confirmed verdict as "still working on it", both shipped green.
 *
 * It is a pure function of (video row, cached object, fetch outcome), so a fake
 * client pins the whole decision table.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTranscript } from "@/lib/transcriptCache";
import { fetchFreshTranscript, type FetchOutcome } from "@/lib/transcript";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/transcript", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/transcript")>();
  return { ...actual, fetchFreshTranscript: vi.fn() };
});

const youtube = vi.mocked(fetchFreshTranscript);

const SEGMENTS = [
  { text: "shalom", offset: 0, duration: 1000 },
  { text: "olam", offset: 1000, duration: 1000 },
];

const CAPTIONS_FOUND: FetchOutcome = {
  status: "ok",
  segments: SEGMENTS,
  language: "he",
  trace: [],
};
const NO_CAPTIONS: FetchOutcome = { status: "unavailable", trace: [] };
const BLOCKED: FetchOutcome = {
  status: "error",
  reason: "player_not_loaded:http_429",
  trace: [],
};

interface VideoRow {
  transcript_status: "pending" | "ready" | "unavailable";
  fetched_at: string | null;
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

/**
 * A `videos` row + Storage object, with the writes recorded. Deliberately not a
 * mock of `getTranscript`'s own helpers: mocking those is what let the warm
 * route's tests assert against states production could not produce.
 */
function fakeStack(init: { row?: VideoRow | null; cached?: unknown } = {}) {
  let row: VideoRow | null = init.row === undefined ? null : init.row;
  let cached: unknown = init.cached ?? null;
  const updates: Record<string, unknown>[] = [];

  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          updates.push(patch);
          if (row) row = { ...row, ...patch } as VideoRow;
          return { data: null, error: null };
        },
      }),
    }),
    storage: {
      from: () => ({
        download: async () =>
          cached
            ? { data: { text: async () => JSON.stringify(cached) }, error: null }
            : { data: null, error: new Error("not found") },
        upload: async (_path: string, body: string) => {
          cached = JSON.parse(body);
          return { data: null, error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;

  return { client, updates, status: () => row?.transcript_status };
}

beforeEach(() => {
  youtube.mockReset();
});

describe("outcomes are never guesses", () => {
  it("reports a blocked fetch as failed, never as unavailable", async () => {
    // The whole point of the union. These were both `null`, so `generate` told
    // teachers a video had no captions whenever YouTube refused us.
    youtube.mockResolvedValue(BLOCKED);
    const { client, status } = fakeStack({ row: { transcript_status: "pending", fetched_at: null } });

    const outcome = await getTranscript(client, "vid");

    expect(outcome.state).toBe("failed");
    if (outcome.state === "failed") expect(outcome.reason).toBe("player_not_loaded:http_429");
    // And it must not be recorded as a verdict about the video.
    expect(status()).toBe("pending");
  });

  it("reports a confirmed caption-less video as unavailable, and records it", async () => {
    youtube.mockResolvedValue(NO_CAPTIONS);
    const { client, status } = fakeStack({ row: { transcript_status: "pending", fetched_at: null } });

    const outcome = await getTranscript(client, "vid");

    expect(outcome.state).toBe("unavailable");
    expect(status()).toBe("unavailable");
  });

  it("reports a standing verdict as throttled, distinct from a fresh failure", async () => {
    const { client } = fakeStack({
      row: { transcript_status: "unavailable", fetched_at: ago(DAY) },
    });

    const outcome = await getTranscript(client, "vid");

    expect(outcome.state).toBe("throttled");
    expect(youtube).not.toHaveBeenCalled();
  });

  it("returns ready with the segments on a successful fetch", async () => {
    youtube.mockResolvedValue(CAPTIONS_FOUND);
    const { client, status } = fakeStack({ row: { transcript_status: "pending", fetched_at: null } });

    const outcome = await getTranscript(client, "vid");

    expect(outcome.state).toBe("ready");
    if (outcome.state === "ready") {
      expect(outcome.segments).toHaveLength(2);
      expect(outcome.language).toBe("he");
    }
    expect(status()).toBe("ready");
  });
});

describe("a failed refresh never loses what we already had", () => {
  it("serves the stale cached transcript when the re-fetch fails", async () => {
    youtube.mockResolvedValue(BLOCKED);
    const { client, status } = fakeStack({
      row: { transcript_status: "ready", fetched_at: ago(40 * DAY) },
      cached: { segments: SEGMENTS, language: "he" },
    });

    const outcome = await getTranscript(client, "vid");

    expect(outcome.state).toBe("ready");
    // Status must not be downgraded by a fetch that never reached YouTube.
    expect(status()).toBe("ready");
  });

  it("serves a fresh cached transcript without fetching at all", async () => {
    const { client } = fakeStack({
      row: { transcript_status: "ready", fetched_at: ago(1000) },
      cached: { segments: SEGMENTS, language: "he" },
    });

    const outcome = await getTranscript(client, "vid");

    expect(outcome.state).toBe("ready");
    expect(youtube).not.toHaveBeenCalled();
  });
});

describe("force", () => {
  it("re-checks a video whose unavailable verdict is still fresh", async () => {
    // A teacher pressing "generate" is an explicit retry. If it does nothing the
    // button looks broken, and one bad fetch becomes permanent for two days.
    youtube.mockResolvedValue(CAPTIONS_FOUND);
    const { client } = fakeStack({
      row: { transcript_status: "unavailable", fetched_at: ago(1000) },
    });

    const outcome = await getTranscript(client, "vid", { force: true });

    expect(youtube).toHaveBeenCalledTimes(1);
    expect(outcome.state).toBe("ready");
  });

  it("leaves the verdict standing for automatic callers", async () => {
    // The tutor runs this per student question; without the throttle a
    // caption-less video costs one upstream request per question.
    const { client } = fakeStack({
      row: { transcript_status: "unavailable", fetched_at: ago(1000) },
    });

    await getTranscript(client, "vid");
    await getTranscript(client, "vid");

    expect(youtube).not.toHaveBeenCalled();
  });
});

describe("concurrent callers share one fetch", () => {
  it("does not fetch twice when a second caller arrives mid-flight", async () => {
    // This replaced a DB claim marker whose loser gave up — which is how a
    // teacher pressing "generate" seconds after the editor warmed the cache was
    // told the video had no captions, while the captions were downloading.
    youtube.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return CAPTIONS_FOUND;
    });
    const { client } = fakeStack({ row: { transcript_status: "pending", fetched_at: null } });

    const [first, second] = await Promise.all([
      getTranscript(client, "vid"),
      getTranscript(client, "vid"),
    ]);

    expect(youtube).toHaveBeenCalledTimes(1);
    // The joiner WAITS for the real answer rather than being told there is none.
    expect(first.state).toBe("ready");
    expect(second.state).toBe("ready");
  });

  it("starts a new fetch once the shared one has settled", async () => {
    // The map must be cleared in a `finally`, or it becomes a permanent cache of
    // the first result and a later retry can never happen.
    youtube.mockResolvedValue(BLOCKED);
    const { client } = fakeStack({ row: { transcript_status: "pending", fetched_at: null } });

    await getTranscript(client, "vid");
    await getTranscript(client, "vid");

    expect(youtube).toHaveBeenCalledTimes(2);
  });

  it("does not let one video's fetch answer for another", async () => {
    youtube.mockResolvedValue(CAPTIONS_FOUND);
    const { client } = fakeStack({ row: { transcript_status: "pending", fetched_at: null } });

    await Promise.all([getTranscript(client, "vid-a"), getTranscript(client, "vid-b")]);

    expect(youtube).toHaveBeenCalledTimes(2);
  });
});

describe("a missing canonical row", () => {
  it("does not fetch, and says so rather than claiming no captions", async () => {
    const { client } = fakeStack({ row: null });

    const outcome = await getTranscript(client, "vid");

    expect(outcome.state).toBe("failed");
    expect(youtube).not.toHaveBeenCalled();
  });
});

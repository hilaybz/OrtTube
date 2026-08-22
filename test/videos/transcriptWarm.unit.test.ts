/**
 * POST /api/quizzes/[id]/transcript — cache warming on page open.
 *
 * The route exists to move a slow fetch off the moment someone is waiting, so
 * what matters is that it cannot be used to reach a quiz the caller has no
 * business touching, and that it cannot be used to spend proxy bandwidth. No
 * network, no DB.
 *
 * It deliberately does NOT report what the fetch concluded. An earlier version
 * returned `{ status: "ready" | "unavailable" | "pending" }`, and the value both
 * callers passed to `.catch(() => {})` turned out to be unreachable in one case
 * and inverted in another — a body nobody reads is a body nobody notices is
 * wrong. The verdict lives on the video row and in the logs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getTranscript = vi.hoisted(() => vi.fn());
vi.mock("@/lib/transcriptCache", () => ({ getTranscript }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));

const getUser = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, from, rpc }),
}));

import { POST } from "@/app/api/quizzes/[id]/transcript/route";

const TEACHER = "teacher-1";
const VIDEO_ROW = { youtube_video_id: "yt-abc" };
const READY = { state: "ready", segments: [{ text: "hi" }], language: "he" };

/** A `.from(...).select(...).eq(...).maybeSingle()` chain resolving to `data`. */
function table(data: unknown) {
  return {
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data }) }) }),
  };
}

/** Distinct users by default: the rate limit is per-user and persists across
 * tests in this module, so a shared id would make later cases fail on it. */
let seq = 0;
function call(body: unknown = {}, userId = `${TEACHER}-${seq++}`) {
  getUser.mockResolvedValue({ data: { user: { id: userId } } });
  const req = { json: async () => body } as Parameters<typeof POST>[0];
  return POST(req, { params: Promise.resolve({ id: "quiz-1" }) });
}

/** The owner-RLS read succeeds, then the video row resolves. */
function ownsQuiz(userId: string) {
  from
    .mockReturnValueOnce(
      table({ id: "quiz-1", author_id: userId, video_id: "v1", deleted_at: null })
    )
    .mockReturnValueOnce(table(VIDEO_ROW));
}

beforeEach(() => {
  getUser.mockReset();
  from.mockReset();
  rpc.mockReset();
  getTranscript.mockReset().mockResolvedValue(READY);
});

describe("authorization", () => {
  it("warms for the quiz owner", async () => {
    const me = "owner-1";
    ownsQuiz(me);

    const res = await call({}, me);

    expect(res.status).toBe(202);
    expect(getTranscript).toHaveBeenCalledWith({}, "yt-abc");
  });

  it("refuses a signed-out caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const req = { json: async () => ({}) } as Parameters<typeof POST>[0];
    const res = await POST(req, { params: Promise.resolve({ id: "quiz-1" }) });
    expect(res.status).toBe(401);
    expect(getTranscript).not.toHaveBeenCalled();
  });

  it("refuses a signed-in stranger with no classId", async () => {
    // Owner-RLS returns nothing for a quiz that isn't theirs, and without a
    // classId there is no membership to fall back on.
    from.mockReturnValueOnce(table(null));
    const res = await call();
    expect(res.status).toBe(403);
    expect(getTranscript).not.toHaveBeenCalled();
  });

  it("refuses a deleted quiz even for its author", async () => {
    const me = "owner-2";
    from.mockReturnValueOnce(
      table({ id: "quiz-1", author_id: me, video_id: "v1", deleted_at: "2026-01-01" })
    );
    const res = await call({}, me);
    expect(res.status).toBe(403);
    expect(getTranscript).not.toHaveBeenCalled();
  });
});

describe("student path", () => {
  beforeEach(() => {
    // Not the author, so the membership gate decides.
    from.mockReturnValue(table(null));
  });

  it("warms for an enrolled student", async () => {
    rpc.mockResolvedValue({
      data: { tutor_mode: "hints", youtube_video_id: "yt-abc" },
      error: null,
    });

    const res = await call({ classId: "class-1" });

    expect(res.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("get_tutor_mode", {
      p_class_id: "class-1",
      p_quiz_id: "quiz-1",
    });
  });

  it("does not fetch when the tutor is off for that class", async () => {
    // The transcript grounds the tutor and nothing else on that page, so with
    // the tutor disabled this would be pure metered proxy bandwidth.
    rpc.mockResolvedValue({
      data: { tutor_mode: "off", youtube_video_id: "yt-abc" },
      error: null,
    });

    const res = await call({ classId: "class-1" });

    expect(res.status).toBe(202);
    expect(getTranscript).not.toHaveBeenCalled();
  });

  it("refuses a non-member", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_member" } });
    const res = await call({ classId: "class-1" });
    expect(res.status).toBe(403);
    expect(getTranscript).not.toHaveBeenCalled();
  });

  it("refuses a quiz not assigned to that class", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_assigned" } });
    const res = await call({ classId: "class-1" });
    expect(res.status).toBe(404);
    expect(getTranscript).not.toHaveBeenCalled();
  });

  it("reports an unrecognised RPC failure as a fault, not a refusal", async () => {
    // A connection blip or a malformed quiz id is not an authorization decision.
    // Answering 403 tells the student they lack permission they may well have,
    // and hides a real fault behind a plausible-looking one.
    rpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    const res = await call({ classId: "class-1" });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("internal_error");
  });
});

describe("cost control", () => {
  it("never forces — page opens are frequent and involuntary", async () => {
    // Forcing ignores the negative cache, so a teacher reloading the editor could
    // re-check a known caption-less video on every load, against metered
    // bandwidth. Pressing "generate" is the explicit human retry that forces.
    const me = "owner-3";
    ownsQuiz(me);

    await call({}, me);

    expect(getTranscript).toHaveBeenCalledWith({}, "yt-abc");
    expect(getTranscript.mock.calls[0][2]).toBeUndefined();
  });

  it("rate-limits a caller looping the endpoint", async () => {
    // Every call past the cache can spend proxy egress, and any signed-in student
    // can reach this route. Without a limit it is an open tap on a metered bill.
    const spammer = "loop-1";
    let refused = 0;
    for (let i = 0; i < 12; i++) {
      ownsQuiz(spammer);
      const res = await call({}, spammer);
      if (res.status === 429) refused++;
    }

    expect(refused).toBeGreaterThan(0);
    expect(getTranscript.mock.calls.length).toBeLessThan(12);
  });

  it("swallows a thrown fetch — warming must never break the page", async () => {
    const me = "owner-4";
    ownsQuiz(me);
    getTranscript.mockRejectedValue(new Error("upstream exploded"));

    const res = await call({}, me);

    expect(res.status).toBe(202);
  });

  it("answers 202 whatever the fetch concluded", async () => {
    // ready / unavailable / throttled / failed all mean the same thing to a
    // caller that fired this and moved on: the work was accepted.
    for (const outcome of [
      READY,
      { state: "unavailable" },
      { state: "throttled" },
      { state: "failed", reason: "player_not_loaded:http_429" },
    ]) {
      const me = `owner-${outcome.state}`;
      ownsQuiz(me);
      getTranscript.mockResolvedValue(outcome);

      const res = await call({}, me);

      expect(res.status).toBe(202);
    }
  });
});

/**
 * POST /api/quizzes/[id]/transcript — cache warming on page open.
 *
 * The route exists to move a slow fetch off the moment someone is waiting, so
 * what matters is that it cannot be used to reach a quiz the caller has no
 * business touching, and that it never spends proxy bandwidth it doesn't have
 * to. No network, no DB.
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

/** A `.from(...).select(...).eq(...).maybeSingle()` chain resolving to `data`. */
function table(data: unknown) {
  return {
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data }) }) }),
  };
}

function call(body: unknown = {}) {
  const req = { json: async () => body } as Parameters<typeof POST>[0];
  return POST(req, { params: Promise.resolve({ id: "quiz-1" }) });
}

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: TEACHER } } });
  from.mockReset();
  rpc.mockReset();
  getTranscript.mockReset().mockResolvedValue({ segments: [{ text: "hi" }] });
});

describe("authorization", () => {
  it("warms for the quiz owner", async () => {
    from
      .mockReturnValueOnce(table({ id: "quiz-1", author_id: TEACHER, video_id: "v1", deleted_at: null }))
      .mockReturnValueOnce(table(VIDEO_ROW));

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready" });
    expect(getTranscript).toHaveBeenCalledWith({}, "yt-abc");
  });

  it("refuses a signed-out caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await call();
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
    from.mockReturnValueOnce(
      table({ id: "quiz-1", author_id: TEACHER, video_id: "v1", deleted_at: "2026-01-01" })
    );
    const res = await call();
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

    expect(await res.json()).toEqual({ status: "ready" });
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

    expect(await res.json()).toEqual({ status: "skipped" });
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
});

describe("fetch behaviour", () => {
  beforeEach(() => {
    from
      .mockReturnValueOnce(table({ id: "quiz-1", author_id: TEACHER, video_id: "v1", deleted_at: null }))
      .mockReturnValueOnce(table(VIDEO_ROW));
  });

  it("never forces — page opens are frequent and involuntary", async () => {
    // Forcing ignores the negative cache and respects only a 30s floor, so a
    // teacher reloading the editor could re-sweep the proxy pool every 30s.
    // Pressing "generate" is the explicit human retry that forces.
    await call();

    expect(getTranscript).toHaveBeenCalledWith({}, "yt-abc");
    expect(getTranscript.mock.calls[0][2]).toBeUndefined();
  });

  it("reports unavailable when the fetch returned no segments", async () => {
    getTranscript.mockResolvedValue({ segments: [] });
    const res = await call();
    expect(await res.json()).toEqual({ status: "unavailable" });
  });

  it("reports pending when nobody has read it yet", async () => {
    // null means the claim was lost or a transient failure is being throttled.
    getTranscript.mockResolvedValue(null);
    const res = await call();
    expect(await res.json()).toEqual({ status: "pending" });
  });

  it("swallows a thrown fetch — warming must never break the page", async () => {
    getTranscript.mockRejectedValue(new Error("upstream exploded"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "pending" });
  });
});

/**
 * Tutor route unit tests — `POST /api/ask` (streaming tutor).
 *
 * All external dependencies (Anthropic, the Supabase user/service clients, the
 * transcript cache) are mocked, so this runs with no DB, no network, and no API
 * key — it verifies the route's control flow and the tutor acceptance criteria:
 * auth, `tutor_off`/`not_member` refusal, spoiler-bounded context, no `is_correct`
 * leak, active-question protection, correct logging FKs, and that a logging
 * failure never breaks the stream.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks (hoisted before the route import) ──────────────────────────────────

const streamMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: streamMock };
  },
}));

const getUserMock = vi.fn();
const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    rpc: rpcMock,
  }),
}));

const insertMock = vi.fn();
// B3/A4: the route validates client-supplied attemptId/questionId and derives
// active-ness from server state via the service client. These configurable mocks
// back the validation queries so the unit test can exercise both validated and
// rejected (spoofed) ids without a DB.
const attemptRowMock = vi.fn(); // .from("attempts")...maybeSingle()  (validation)
const questionRowMock = vi.fn(); // .from("questions")...maybeSingle() (validation)
const inProgressMock = vi.fn(); // .from("attempts")...limit()        (active check)
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === "tutor_questions") return { insert: insertMock };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        limit: () =>
          table === "attempts" ? inProgressMock() : Promise.resolve({ data: [] }),
        maybeSingle: () =>
          table === "attempts" ? attemptRowMock() : questionRowMock(),
      };
      return builder;
    },
  }),
}));

const getTranscriptMock = vi.fn();
vi.mock("@/lib/transcriptCache", () => ({
  getTranscript: (...args: unknown[]) => getTranscriptMock(...args),
}));

import { POST } from "@/app/api/ask/route";

// ── Helpers ──────────────────────────────────────────────────────────────────

function textStream(text: string) {
  return (async function* () {
    yield { type: "content_block_delta", delta: { type: "text_delta", text } };
  })();
}

/** A student POSTs a tutor question to /api/ask with the given body. */
function askRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// The per-class tutor context the RPC returns for a member of an assigned class.
const TUTOR_CONTEXT = {
  tutor_mode: "hints" as const,
  class_language: "he",
  base_language: "he",
  preferred_language: null,
  video_id: "vid-uuid",
  youtube_video_id: "yt123",
};

/** The system prompt + user messages handed to the last Anthropic stream call. */
function lastStreamArgs() {
  const call = streamMock.mock.calls.at(-1);
  return call?.[0] as { system: string; messages: { content: string }[] };
}

const BASE_BODY = {
  classId: "class-uuid",
  quizId: "quiz-uuid",
  videoId: "yt123",
  positionSeconds: 30,
  prompt: "Can you explain this part?",
};

// A fresh user id per test keeps the route's per-user in-memory rate limiter
// (module-scoped, persists across tests) from tripping after 10 requests.
let userCounter = 0;
let currentUserId = "student-uuid";

beforeEach(() => {
  vi.clearAllMocks();
  userCounter += 1;
  currentUserId = `student-uuid-${userCounter}`;
  getUserMock.mockResolvedValue({ data: { user: { id: currentUserId } } });
  rpcMock.mockResolvedValue({ data: TUTOR_CONTEXT, error: null });
  // Defaults: the supplied attempt/question belong to the caller + this quiz, and
  // there is no separately-detected in-progress attempt.
  attemptRowMock.mockResolvedValue({
    data: { student_id: currentUserId, quiz_id: "quiz-uuid" },
  });
  questionRowMock.mockResolvedValue({ data: { quiz_id: "quiz-uuid" } });
  inProgressMock.mockResolvedValue({ data: [] });
  getTranscriptMock.mockResolvedValue({
    segments: [{ text: "watched content", offset: 0, duration: 5000 }],
    language: "he",
  });
  streamMock.mockReturnValue(textStream("Here is a hint."));
  insertMock.mockResolvedValue({ error: null });
});

// ── Auth & validation ────────────────────────────────────────────────────────

describe("auth & validation", () => {
  it("401 when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const response = await POST(askRequest(BASE_BODY));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("unauthenticated");
  });

  it("400 when classId/quizId missing", async () => {
    const response = await POST(askRequest({ ...BASE_BODY, quizId: undefined }));
    expect(response.status).toBe(400);
  });

  it("400 when prompt is empty", async () => {
    const response = await POST(askRequest({ ...BASE_BODY, prompt: "  " }));
    expect(response.status).toBe(400);
  });
});

// ── Membership / mode gating ─────────────────────────────────────────────────

describe("membership & mode gating", () => {
  it("403 tutor_off when the class has tutoring disabled", async () => {
    rpcMock.mockResolvedValue({ data: { ...TUTOR_CONTEXT, tutor_mode: "off" }, error: null });
    const response = await POST(askRequest(BASE_BODY));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("tutor_off");
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("403 not_member when the RPC rejects a non-member", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not_member" } });
    const response = await POST(askRequest(BASE_BODY));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("not_member");
  });

  it("404 not_assigned when the quiz is not assigned to the class", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not_assigned" } });
    const response = await POST(askRequest(BASE_BODY));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("not_assigned");
  });
});

// ── Happy path: streaming + context + logging ────────────────────────────────

describe("streaming, context, logging", () => {
  it("streams Claude's answer back to the client", async () => {
    const response = await POST(askRequest(BASE_BODY));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Here is a hint.");
  });

  it("resolves language via precedence (preferred > class > base)", async () => {
    rpcMock.mockResolvedValue({
      data: { ...TUTOR_CONTEXT, preferred_language: "ar", class_language: "he", base_language: "en" },
      error: null,
    });
    await POST(askRequest(BASE_BODY));
    expect(lastStreamArgs().system).toContain("Arabic");
  });

  it("bounds transcript context to the playhead (no spoilers)", async () => {
    getTranscriptMock.mockResolvedValue({
      segments: [
        { text: "watched intro", offset: 0, duration: 5000 },
        { text: "future spoiler content", offset: 300000, duration: 5000 },
      ],
      language: "he",
    });
    await POST(askRequest({ ...BASE_BODY, positionSeconds: 30 }));
    const userMessage = lastStreamArgs().messages[0].content;
    expect(userMessage).toContain("watched intro");
    expect(userMessage).not.toContain("future spoiler content");
  });

  it("never includes 'is_correct' in the prompt (with an active question)", async () => {
    await POST(askRequest({ ...BASE_BODY, activeQuestionId: "question-uuid" }));
    const { system, messages } = lastStreamArgs();
    expect(system).not.toContain("is_correct");
    expect(messages[0].content).not.toContain("is_correct");
    // Active-question protection is present in the system prompt.
    expect(system).toContain("NEVER");
  });

  it("logs a tutor_questions row with the correct FKs", async () => {
    const response = await POST(
      askRequest({
        ...BASE_BODY,
        attemptId: "attempt-uuid",
        activeQuestionId: "question-uuid",
        positionSeconds: 42,
      })
    );
    await response.text(); // drain the stream so start()'s logging completes
    expect(insertMock).toHaveBeenCalledTimes(1);
    const loggedRow = insertMock.mock.calls[0][0];
    expect(loggedRow).toMatchObject({
      student_id: currentUserId,
      class_id: "class-uuid",
      quiz_id: "quiz-uuid",
      video_id: "vid-uuid", // canonical video from the RPC, not the client body
      attempt_id: "attempt-uuid",
      question_id: "question-uuid",
      position_seconds: 42,
      prompt: BASE_BODY.prompt,
      ai_response: "Here is a hint.",
    });
  });

  it("logs null attempt_id/question_id when none are supplied", async () => {
    const response = await POST(askRequest(BASE_BODY));
    await response.text(); // drain the stream so start()'s logging completes
    const loggedRow = insertMock.mock.calls[0][0];
    expect(loggedRow.attempt_id).toBeNull();
    expect(loggedRow.question_id).toBeNull();
  });

  // B3: a client can pass arbitrary attemptId/questionId; the route must null out
  // any that do not belong to the caller / this quiz before logging.
  it("nulls out an attemptId that belongs to another student", async () => {
    attemptRowMock.mockResolvedValue({
      data: { student_id: "someone-else", quiz_id: "quiz-uuid" },
    });
    const response = await POST(
      askRequest({ ...BASE_BODY, attemptId: "foreign-attempt" })
    );
    await response.text();
    expect(insertMock.mock.calls[0][0].attempt_id).toBeNull();
  });

  it("nulls out an attemptId that is on a different quiz", async () => {
    attemptRowMock.mockResolvedValue({
      data: { student_id: currentUserId, quiz_id: "other-quiz" },
    });
    const response = await POST(
      askRequest({ ...BASE_BODY, attemptId: "attempt-on-other-quiz" })
    );
    await response.text();
    expect(insertMock.mock.calls[0][0].attempt_id).toBeNull();
  });

  it("nulls out a questionId that belongs to a different quiz", async () => {
    questionRowMock.mockResolvedValue({ data: { quiz_id: "other-quiz" } });
    const response = await POST(
      askRequest({ ...BASE_BODY, activeQuestionId: "foreign-question" })
    );
    await response.text();
    expect(insertMock.mock.calls[0][0].question_id).toBeNull();
  });

  // A4: the answer-leak guard is present even when the client sends no
  // activeQuestionId and there is no detected in-progress attempt.
  it("keeps the answer-leak guard with no active question and no in-progress attempt", async () => {
    inProgressMock.mockResolvedValue({ data: [] });
    await POST(askRequest(BASE_BODY)); // no activeQuestionId
    expect(lastStreamArgs().system).toContain("NEVER");
  });

  it("a logging failure does NOT break the stream", async () => {
    insertMock.mockResolvedValue({ error: { message: "insert boom" } });
    const response = await POST(askRequest(BASE_BODY));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Here is a hint.");
  });

  it("a thrown logging error does NOT break the stream", async () => {
    insertMock.mockRejectedValue(new Error("network down"));
    const response = await POST(askRequest(BASE_BODY));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Here is a hint.");
  });

  it("still answers when no transcript is available", async () => {
    getTranscriptMock.mockResolvedValue(null);
    const response = await POST(askRequest(BASE_BODY));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Here is a hint.");
    expect(lastStreamArgs().messages[0].content.toLowerCase()).toContain(
      "no transcript"
    );
  });

  it("still answers when the transcript fetch throws", async () => {
    getTranscriptMock.mockRejectedValue(new Error("storage down"));
    const response = await POST(askRequest(BASE_BODY));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Here is a hint.");
  });
});

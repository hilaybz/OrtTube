/**
 * Quiz route unit test — `POST /api/quizzes/[id]/generate` transcript warming (C1).
 *
 * All I/O (Supabase user/service clients, the transcript cache, the AI generator,
 * persistence) is mocked, so this runs with no DB, no network, and no API key. It
 * pins the C1 fix: a video whose transcript_status is 'pending' is WARMED via
 * getTranscript instead of being refused with a 409 before any fetch; only a
 * CONFIRMED 'unavailable' video 409s up front.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
const fromMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: fromMock }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ __service: true }),
}));

const getTranscriptMock = vi.fn();
vi.mock("@/lib/transcriptCache", () => ({
  getTranscript: (...args: unknown[]) => getTranscriptMock(...args),
}));

const generateMock = vi.fn();
vi.mock("@/lib/ai/generate", () => ({
  generateQuizQuestions: (...args: unknown[]) => generateMock(...args),
}));

const persistMock = vi.fn();
vi.mock("@/lib/quiz", () => ({
  persistGeneratedQuestions: (...args: unknown[]) => persistMock(...args),
  QuizError: class QuizError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));

import { POST } from "@/app/api/quizzes/[id]/generate/route";

const TEACHER_ID = "teacher-uuid";

/** The teacher POSTs to generate questions for quiz-1, optionally with a body. */
function generateRequest(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("http://localhost/api/quizzes/quiz-1/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const routeParams = Promise.resolve({ id: "quiz-1" });

/** Wire supabase.from("quizzes"/"videos") to return the given rows. */
function stubQuizAndVideo(quizRow: unknown, videoRow: unknown) {
  fromMock.mockImplementation((table: string) => {
    const row = table === "quizzes" ? quizRow : videoRow;
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row }) }),
      }),
    };
  });
}

// The quiz being generated: authored by our teacher, on video vid-1, in Hebrew.
const authoredQuiz = {
  id: "quiz-1",
  author_id: TEACHER_ID,
  video_id: "vid-1",
  base_language: "he",
  deleted_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: TEACHER_ID } } });
  generateMock.mockResolvedValue([
    {
      kind: "single",
      position_seconds: 10,
      order_index: 0,
      base_prompt: "q",
      base_explanation: "e",
      options: [{ base_text: "a", is_correct: true, order_index: 0 }],
    },
  ]);
  persistMock.mockResolvedValue(["question-1"]);
  getTranscriptMock.mockResolvedValue({
    segments: [{ text: "hello world", offset: 0, duration: 4000 }],
    language: "he",
  });
});

describe("generate route transcript warming (C1)", () => {
  it("warms a 'pending' transcript instead of returning 409", async () => {
    stubQuizAndVideo(authoredQuiz, {
      youtube_video_id: "yt-pending",
      transcript_status: "pending",
    });

    const response = await POST(generateRequest({ count: 1 }), { params: routeParams });

    // Must have attempted to warm the cache, and NOT refused up front.
    expect(getTranscriptMock).toHaveBeenCalledWith(
      { __service: true },
      "yt-pending"
    );
    expect(response.status).toBe(201);
  });

  it("refuses a CONFIRMED unavailable video with 409 without fetching", async () => {
    stubQuizAndVideo(authoredQuiz, {
      youtube_video_id: "yt-none",
      transcript_status: "unavailable",
    });

    const response = await POST(generateRequest({ count: 1 }), { params: routeParams });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("transcript_unavailable");
    expect(getTranscriptMock).not.toHaveBeenCalled();
  });

  it("409s a 'pending' video when warming yields no usable segments", async () => {
    stubQuizAndVideo(authoredQuiz, {
      youtube_video_id: "yt-empty",
      transcript_status: "pending",
    });
    getTranscriptMock.mockResolvedValue({ segments: [], language: null });

    const response = await POST(generateRequest({ count: 1 }), { params: routeParams });

    expect(getTranscriptMock).toHaveBeenCalled();
    expect(response.status).toBe(409);
  });
});

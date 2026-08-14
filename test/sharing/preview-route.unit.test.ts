/**
 * Quiz route unit test — `GET /api/quizzes/[id]/preview` (backlog 1.3 /
 * issue #13).
 *
 * `getQuizForPreview` and Supabase are mocked, so this runs with no DB and no
 * network. What it pins is the handler's contract: 401 before anything is
 * attempted, and the `SharingError` -> HTTP status mapping (`statusForCode`
 * in `../../share/http`) this route deliberately reuses rather than the
 * `[id]/*` authoring routes' `QuizError`-based plumbing — see
 * `delete-route.unit.test.ts` for the equivalent test on that other family.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

const getQuizForPreviewMock = vi.fn();
// Keep the real SharingError: `handleError` narrows on `instanceof`, so a
// stand-in class would silently fall through to a 500 and hide a broken
// status mapping.
vi.mock("@/lib/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sharing")>()),
  getQuizForPreview: (...args: unknown[]) => getQuizForPreviewMock(...args),
}));

import { GET } from "@/app/api/quizzes/[id]/preview/route";
import { SharingError } from "@/lib/sharing";

const TEACHER_ID = "teacher-uuid";
const QUIZ_ID = "quiz-1";

function signedIn(): void {
  getUserMock.mockResolvedValue({ data: { user: { id: TEACHER_ID } } });
}

function previewQuiz(quizId = QUIZ_ID) {
  const req = new NextRequest(`http://localhost/api/quizzes/${quizId}/preview`);
  return GET(req, { params: Promise.resolve({ id: quizId }) });
}

describe("GET /api/quizzes/[id]/preview", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    getQuizForPreviewMock.mockReset();
  });

  it("returns the quiz for a caller who may read it", async () => {
    signedIn();
    const quiz = { quiz_id: QUIZ_ID, questions: [] };
    getQuizForPreviewMock.mockResolvedValue(quiz);

    const res = await previewQuiz();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ quiz });
    expect(getQuizForPreviewMock).toHaveBeenCalledWith(expect.anything(), QUIZ_ID);
  });

  it("rejects an anonymous caller with 401 and never touches the RPC", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const res = await previewQuiz();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: expect.any(String) },
    });
    expect(getQuizForPreviewMock).not.toHaveBeenCalled();
  });

  it("forwards the RPC's not_authorized verdict as 403", async () => {
    signedIn();
    getQuizForPreviewMock.mockRejectedValue(new SharingError("not_authorized"));

    const res = await previewQuiz();

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("not_authorized");
  });

  it("forwards a soft-deleted quiz as 403 quiz_deleted", async () => {
    signedIn();
    getQuizForPreviewMock.mockRejectedValue(new SharingError("quiz_deleted"));

    const res = await previewQuiz();

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("quiz_deleted");
  });

  it("forwards a missing quiz as 404", async () => {
    signedIn();
    getQuizForPreviewMock.mockRejectedValue(new SharingError("quiz_not_found"));

    const res = await previewQuiz();

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("quiz_not_found");
  });

  it("does not leak an unexpected failure's detail", async () => {
    signedIn();
    getQuizForPreviewMock.mockRejectedValue(new Error("connection reset"));

    const res = await previewQuiz();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("connection reset");
  });
});

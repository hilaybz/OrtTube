import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getClaimsMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: getClaimsMock } }),
}));

const softDeleteQuizMock = vi.fn();
vi.mock("@/lib/quiz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/quiz")>()),
  softDeleteQuiz: (...args: unknown[]) => softDeleteQuizMock(...args),
}));

import { DELETE } from "@/app/api/quizzes/[id]/route";
import { QuizError } from "@/lib/quiz";

const TEACHER_ID = "teacher-uuid";
const QUIZ_ID = "quiz-1";

function signedIn(): void {
  getClaimsMock.mockResolvedValue({ data: { claims: { sub: TEACHER_ID } } });
}

function deleteQuiz(quizId = QUIZ_ID) {
  const req = new NextRequest(`http://localhost/api/quizzes/${quizId}`, {
    method: "DELETE",
  });
  return DELETE(req, { params: Promise.resolve({ id: quizId }) });
}

describe("DELETE /api/quizzes/[id]", () => {
  beforeEach(() => {
    getClaimsMock.mockReset();
    softDeleteQuizMock.mockReset();
  });

  it("soft-deletes the quiz and returns 204 with no body", async () => {
    signedIn();
    softDeleteQuizMock.mockResolvedValue(undefined);

    const res = await deleteQuiz();

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(softDeleteQuizMock).toHaveBeenCalledWith(expect.anything(), QUIZ_ID);
  });

  it("rejects an anonymous caller with 401 and never touches the quiz", async () => {
    getClaimsMock.mockResolvedValue({ data: null });

    const res = await deleteQuiz();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: expect.any(String) },
    });
    expect(softDeleteQuizMock).not.toHaveBeenCalled();
  });

  it("forwards the RPC's not_owner verdict as 403", async () => {
    signedIn();
    softDeleteQuizMock.mockRejectedValue(new QuizError("not_owner"));

    const res = await deleteQuiz();

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("not_owner");
  });

  it("forwards a missing quiz as 404", async () => {
    signedIn();
    softDeleteQuizMock.mockRejectedValue(
      new QuizError("quiz_not_found")
    );

    const res = await deleteQuiz();

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("quiz_not_found");
  });

  it("does not leak an unexpected failure's detail", async () => {
    signedIn();
    softDeleteQuizMock.mockRejectedValue(new Error("connection reset"));

    const res = await deleteQuiz();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("connection reset");
  });
});

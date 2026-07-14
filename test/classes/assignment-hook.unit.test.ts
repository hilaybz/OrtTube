/**
 * Unit tests — the eager-translation hook in `assignQuizToClass`.
 *
 * Pure logic, no DB: a fake Supabase client returns a canned assignment row and
 * an injected `ensureTranslation` spy records how it is (or isn't) called. Proves
 * the hook fires for a class language != base, is skipped when they match, and is
 * best-effort (a translation throw never fails the assignment).
 */
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assignQuizToClass,
  type EnsureTranslationFn,
} from "@/lib/classes";
import type { EnsureTranslationResult } from "@/lib/quiz";

function fakeClient(assignment: Record<string, unknown>): SupabaseClient {
  return {
    rpc: async () => ({ data: assignment, error: null }),
  } as unknown as SupabaseClient;
}

const baseAssignment = {
  class_id: "c1",
  quiz_id: "q1",
  tutor_mode: "hints",
  max_attempts: 1,
  base_language: "he",
};

const okResult: EnsureTranslationResult = {
  status: "filled",
  language: "en",
  questionsTranslated: 0,
  optionsTranslated: 0,
};

describe("assignQuizToClass translation hook", () => {
  it("fires ensureTranslation into the class language when it differs from base", async () => {
    const client = fakeClient({ ...baseAssignment, class_language: "en" });
    const ensure = vi.fn<EnsureTranslationFn>(async () => okResult);

    const result = await assignQuizToClass(
      client,
      { classId: "c1", quizId: "q1" },
      { ensureTranslation: ensure, awaitTranslation: true }
    );

    expect(result.class_language).toBe("en");
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure.mock.calls[0][0]).toBe("q1");
    expect(ensure.mock.calls[0][1]).toBe("en");
  });

  it("skips translation when the class language equals the base language", async () => {
    const client = fakeClient({ ...baseAssignment, class_language: "he" });
    const ensure = vi.fn<EnsureTranslationFn>(async () => okResult);

    await assignQuizToClass(
      client,
      { classId: "c1", quizId: "q1" },
      { ensureTranslation: ensure, awaitTranslation: true }
    );

    expect(ensure).not.toHaveBeenCalled();
  });

  it("is best-effort: a translation failure does not fail the assignment", async () => {
    const client = fakeClient({ ...baseAssignment, class_language: "ar" });
    const ensure = vi.fn<EnsureTranslationFn>(async () => {
      throw new Error("claude exploded");
    });

    const result = await assignQuizToClass(
      client,
      { classId: "c1", quizId: "q1" },
      { ensureTranslation: ensure, awaitTranslation: true }
    );

    expect(result.quiz_id).toBe("q1");
    expect(ensure).toHaveBeenCalledTimes(1);
  });
});

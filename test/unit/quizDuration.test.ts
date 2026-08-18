/**
 * Unit tests for the quiz-duration display logic (issue #80) — no DB, no
 * React. Pure functions in `lib/quizDuration.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  estimateQuizMinutes,
  quizDurationMinutes,
  formatQuizDuration,
} from "@/lib/quizDuration";

describe("estimateQuizMinutes", () => {
  it("rounds up to the next 5-minute increment", () => {
    expect(estimateQuizMinutes(60)).toBe(5); // 1 min -> 5
    expect(estimateQuizMinutes(301)).toBe(10); // just over 5 min -> 10
  });

  it("leaves an exact 5-minute multiple unchanged", () => {
    expect(estimateQuizMinutes(300)).toBe(5);
    expect(estimateQuizMinutes(600)).toBe(10);
  });

  it("returns null for null, zero, or negative input", () => {
    expect(estimateQuizMinutes(null)).toBeNull();
    expect(estimateQuizMinutes(0)).toBeNull();
    expect(estimateQuizMinutes(-30)).toBeNull();
  });
});

describe("quizDurationMinutes", () => {
  it("restricted with a stored value returns it, not estimated", () => {
    expect(
      quizDurationMinutes({
        time_restricted: true,
        duration_minutes: 12,
        duration_seconds: 9999,
      })
    ).toEqual({ minutes: 12, estimated: false });
  });

  it("restricted but duration_minutes unexpectedly null returns null (defensive)", () => {
    expect(
      quizDurationMinutes({
        time_restricted: true,
        duration_minutes: null,
        duration_seconds: 600,
      })
    ).toBeNull();
  });

  it("unrestricted derives the estimate from video length", () => {
    expect(
      quizDurationMinutes({
        time_restricted: false,
        duration_minutes: null,
        duration_seconds: 301,
      })
    ).toEqual({ minutes: 10, estimated: true });
  });

  it("unrestricted with an unknown video length returns null", () => {
    expect(
      quizDurationMinutes({
        time_restricted: false,
        duration_minutes: null,
        duration_seconds: null,
      })
    ).toBeNull();
  });
});

describe("formatQuizDuration", () => {
  it("restricted shows a bare number, no tilde", () => {
    expect(
      formatQuizDuration({ time_restricted: true, duration_minutes: 12, duration_seconds: null })
    ).toBe("12 דקות");
  });

  it("unrestricted shows a tilde-prefixed estimate", () => {
    expect(
      formatQuizDuration({ time_restricted: false, duration_minutes: null, duration_seconds: 301 })
    ).toBe("~10 דקות");
  });

  it("returns null when nothing can be shown", () => {
    expect(
      formatQuizDuration({ time_restricted: false, duration_minutes: null, duration_seconds: null })
    ).toBeNull();
  });
});

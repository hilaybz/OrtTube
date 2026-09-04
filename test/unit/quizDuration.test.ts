/**
 * Unit tests for the quiz-duration display logic (issue #80) — no DB, no
 * React. Pure functions in `lib/quizDuration.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  estimateQuizMinutes,
  quizDurationMinutes,
  formatQuizDuration,
  formatVideoLength,
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

/**
 * How long the video RUNS, as words rather than `10:00`.
 *
 * The editor header used to render `formatTime`, so "אורך הסרטון 10:00" gave no
 * unit at all — ten minutes or ten hours — and an hour-long video read
 * "1:02:34". These pin the wording, including the Hebrew forms that are not a
 * plain numeral.
 */
describe("formatVideoLength", () => {
  const mins = (m: number, s = 0) => m * 60 + s;

  it("rounds UP to the next whole minute", () => {
    // Seconds are noise at this scale, and rounding down would understate a
    // length a teacher is judging a lesson against.
    expect(formatVideoLength(mins(12, 34))).toBe("13 דקות");
    expect(formatVideoLength(mins(12, 1))).toBe("13 דקות");
    expect(formatVideoLength(mins(12))).toBe("12 דקות");
  });

  it("says a single minute in the singular", () => {
    expect(formatVideoLength(45)).toBe("דקה");
    expect(formatVideoLength(mins(1))).toBe("דקה");
  });

  it("never rounds a real video down to nothing", () => {
    // A few seconds of video is still a video; "0 דקות" would read as an error.
    expect(formatVideoLength(3)).toBe("דקה");
    expect(formatVideoLength(0)).toBe("דקה");
  });

  it("uses the Hebrew dual for exactly two hours, not a numeral", () => {
    // "2 שעות" is what a naive formatter emits and what a Hebrew speaker does
    // not say.
    expect(formatVideoLength(mins(120))).toBe("שעתיים");
    expect(formatVideoLength(mins(126))).toBe("שעתיים ו-6 דקות");
  });

  it("says one hour in the singular", () => {
    expect(formatVideoLength(mins(60))).toBe("שעה");
    expect(formatVideoLength(mins(63))).toBe("שעה ו-3 דקות");
  });

  it("drops the minutes entirely on an exact hour", () => {
    // "שעה ו-0 דקות" would be the giveaway of a formatter nobody read.
    expect(formatVideoLength(mins(180))).toBe("3 שעות");
  });

  it("counts hours with a numeral past two", () => {
    expect(formatVideoLength(mins(200))).toBe("3 שעות ו-20 דקות");
  });

  it("says a single trailing minute in the singular too", () => {
    expect(formatVideoLength(mins(61))).toBe("שעה ודקה");
  });
});

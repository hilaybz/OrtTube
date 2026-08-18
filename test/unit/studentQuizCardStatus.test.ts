/**
 * Unit tests for the student feed card's per-status badge/CTA/attempts-note
 * derivation (student page redesign) — no DB, no React. `missed` is
 * deliberately excluded here: `QuizCard` never calls these helpers for it
 * (it renders its own fixed "פוספס" badge and no CTA/attempts-note at all —
 * see `components/student/QuizCard.tsx`), so there is nothing to derive.
 */
import { describe, it, expect } from "vitest";
import { badgeFor, ctaFor, attemptsNote } from "@/components/student/QuizCard";
import type { StudentFeedItem } from "@/lib/classes";

function item(overrides: Partial<StudentFeedItem> = {}): StudentFeedItem {
  return {
    class_id: "c1",
    class_name: "כיתה א",
    teacher_name: "מורה",
    quiz_id: "q1",
    title: "חידון",
    youtube_video_id: "yt1",
    video_title: "סרטון",
    duration_seconds: null,
    time_restricted: false,
    duration_minutes: null,
    max_attempts: 2,
    available_until: null,
    assigned_at: "2026-01-01T00:00:00.000Z",
    is_live: true,
    status: "not_started",
    attempts_left: 2,
    last_num_correct: null,
    last_num_questions: null,
    last_completed_at: null,
    resume_attempt_id: null,
    ...overrides,
  };
}

describe("badgeFor", () => {
  it("not_started → gray, not-yet label", () => {
    expect(badgeFor(item({ status: "not_started" }))).toEqual({
      text: "טרם התחלת",
      variant: "gray",
    });
  });

  it("in_progress → brand, in-progress label", () => {
    expect(badgeFor(item({ status: "in_progress" }))).toEqual({
      text: "בתהליך",
      variant: "brand",
    });
  });

  it("completed → success, rounded percentage", () => {
    const badge = badgeFor(
      item({ status: "completed", last_num_correct: 1, last_num_questions: 3 })
    );
    expect(badge).toEqual({ text: "33%", variant: "success" });
  });

  it("completed with no question counts falls back to a plain label instead of NaN%", () => {
    const badge = badgeFor(
      item({ status: "completed", last_num_correct: null, last_num_questions: null })
    );
    expect(badge).toEqual({ text: "הושלם", variant: "success" });
  });
});

describe("ctaFor", () => {
  it("not_started → start", () => {
    expect(ctaFor(item({ status: "not_started" }))).toBe("התחלה");
  });

  it("in_progress → resume", () => {
    expect(ctaFor(item({ status: "in_progress" }))).toBe("המשך");
  });

  it("completed, live, attempts remaining → retry", () => {
    expect(
      ctaFor(item({ status: "completed", is_live: true, attempts_left: 1 }))
    ).toBe("ניסיון נוסף");
  });

  it("completed, live, unlimited attempts → retry", () => {
    expect(
      ctaFor(item({ status: "completed", is_live: true, attempts_left: null, max_attempts: null }))
    ).toBe("ניסיון נוסף");
  });

  it("completed but no attempts left → view results, not retry", () => {
    expect(
      ctaFor(item({ status: "completed", is_live: true, attempts_left: 0 }))
    ).toBe("צפייה בתוצאות");
  });

  it("completed but the allocation is no longer live → view results, even with attempts left", () => {
    expect(
      ctaFor(item({ status: "completed", is_live: false, attempts_left: 1 }))
    ).toBe("צפייה בתוצאות");
  });
});

describe("attemptsNote", () => {
  it("reports remaining vs. max when limited", () => {
    expect(attemptsNote(item({ max_attempts: 3, attempts_left: 2 }))).toBe(
      "נותרו 2 מתוך 3 ניסיונות"
    );
  });

  it("reports unlimited when max_attempts is null", () => {
    expect(attemptsNote(item({ max_attempts: null }))).toBe("ניסיונות ללא הגבלה");
  });
});

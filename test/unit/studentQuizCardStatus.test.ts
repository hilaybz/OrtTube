/**
 * Unit tests for the student feed card's per-status derivations — badge, CTA,
 * attempts note, destination and status block — with no DB and no React.
 *
 * `missed` appears only where it can: `QuizCard` renders its own fixed "פוספס"
 * badge and no CTA or attempts note for it (there is nothing to attempt), but it
 * does get a status block, so `feedStatus` covers it.
 */
import { describe, it, expect } from "vitest";
import {
  badgeFor,
  ctaFor,
  attemptsNote,
  feedStatus,
  hrefFor,
} from "@/components/student/QuizCard";
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

  it("completed → success, the state only; the grade is the status block's job", () => {
    const badge = badgeFor(
      item({ status: "completed", last_num_correct: 1, last_num_questions: 3 })
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

describe("hrefFor", () => {
  it("sends a finished quiz with no retake straight to its results", () => {
    expect(
      hrefFor(item({ status: "completed", is_live: true, attempts_left: 0 }))
    ).toBe("/student/quiz/c1/q1/results");
  });

  it("sends a finished quiz that can be retaken to the player", () => {
    expect(
      hrefFor(item({ status: "completed", is_live: true, attempts_left: 1 }))
    ).toBe("/student/quiz/c1/q1");
  });

  it("sends an unfinished quiz to the player", () => {
    expect(hrefFor(item({ status: "not_started" }))).toBe("/student/quiz/c1/q1");
    expect(hrefFor(item({ status: "in_progress" }))).toBe("/student/quiz/c1/q1");
  });

  it("sends a finished quiz whose window closed to its results", () => {
    expect(
      hrefFor(item({ status: "completed", is_live: false, attempts_left: 2 }))
    ).toBe("/student/quiz/c1/q1/results");
  });
});

/**
 * The status block's wording, at a fixed instant (11:00 Israeli time on Saturday
 * 14 March 2026) so "today" and "tomorrow" mean something stable.
 */
describe("feedStatus", () => {
  const now = new Date("2026-03-14T09:00:00.000Z");

  it("answers a finished quiz with its grade, sized up, and the date it was handed in", () => {
    expect(
      feedStatus(
        item({
          status: "completed",
          last_num_correct: 1,
          last_num_questions: 3,
          last_completed_at: "2026-03-10T18:00:00.000Z",
        }),
        now
      )
    ).toEqual({
      icon: "award",
      tone: "success",
      headline: "ציון 33",
      strong: true,
      meta: "הוגש ב-10.3",
    });
  });

  it("falls back to a plain label when an attempt recorded no questions to grade", () => {
    const status = feedStatus(
      item({ status: "completed", last_num_correct: null, last_num_questions: null }),
      now
    );
    expect(status.headline).toBe("הושלם");
    expect(status.strong).toBe(false);
  });

  it("says a missed quiz was never handed in, and when it closed", () => {
    expect(
      feedStatus(
        item({ status: "missed", available_until: "2026-03-10T18:00:00.000Z" }),
        now
      )
    ).toEqual({
      icon: "closeCircle",
      tone: "danger",
      headline: "לא הוגש",
      meta: "נסגר ב-10.3",
    });
  });

  it("states plainly that a quiz has no deadline rather than inventing urgency", () => {
    const status = feedStatus(item({ status: "not_started", available_until: null }), now);
    expect(status).toEqual({
      icon: "clock",
      tone: "neutral",
      headline: "ללא מועד הגשה",
      meta: "אפשר להתחיל מתי שנוח לך",
    });
  });

  it("counts a far deadline in days, quietly", () => {
    const status = feedStatus(
      item({ status: "not_started", available_until: "2026-03-17T16:00:00.000Z" }),
      now
    );
    expect(status.headline).toBe("בעוד 3 ימים");
    expect(status.tone).toBe("neutral");
    expect(status.meta).toBe("מועד הגשה · 17.3 בשעה 18:00");
  });

  it("warns on tomorrow, and names the hour", () => {
    const status = feedStatus(
      item({ status: "not_started", available_until: "2026-03-15T16:00:00.000Z" }),
      now
    );
    expect(status.headline).toBe("מחר");
    expect(status.tone).toBe("warning");
    expect(status.meta).toBe("מועד הגשה · עד 18:00");
  });

  it("counts the last hour down to the minute, in the urgent tone", () => {
    const status = feedStatus(
      item({ status: "in_progress", available_until: "2026-03-14T09:30:00.000Z" }),
      now
    );
    expect(status.headline).toBe("נותרו 30:00");
    expect(status.tone).toBe("danger");
    expect(status.icon).toBe("timer");
  });
});

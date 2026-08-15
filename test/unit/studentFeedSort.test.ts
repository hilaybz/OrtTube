/**
 * Unit tests for the student feed's bucketing/sort helpers (student page
 * redesign — two sections instead of per-class tabs) — no DB, no React.
 */
import { describe, it, expect } from "vitest";
import { sortNotYetAttempted, sortFinished } from "@/components/student/StudentFeed";
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
    max_attempts: 1,
    available_until: null,
    assigned_at: "2026-01-01T00:00:00.000Z",
    is_live: true,
    status: "not_started",
    attempts_left: 1,
    last_num_correct: null,
    last_num_questions: null,
    last_completed_at: null,
    resume_attempt_id: null,
    ...overrides,
  };
}

describe("sortNotYetAttempted", () => {
  it("sorts by soonest deadline first", () => {
    const later = item({ quiz_id: "later", available_until: "2026-03-01T00:00:00.000Z" });
    const sooner = item({ quiz_id: "sooner", available_until: "2026-02-01T00:00:00.000Z" });
    expect(sortNotYetAttempted([later, sooner]).map((i) => i.quiz_id)).toEqual([
      "sooner",
      "later",
    ]);
  });

  it("sinks no-deadline items to the end", () => {
    const noDeadline = item({ quiz_id: "none", available_until: null });
    const withDeadline = item({ quiz_id: "some", available_until: "2026-02-01T00:00:00.000Z" });
    expect(sortNotYetAttempted([noDeadline, withDeadline]).map((i) => i.quiz_id)).toEqual([
      "some",
      "none",
    ]);
  });

  it("breaks a no-deadline tie by newest-assigned first", () => {
    const older = item({ quiz_id: "older", assigned_at: "2026-01-01T00:00:00.000Z" });
    const newer = item({ quiz_id: "newer", assigned_at: "2026-02-01T00:00:00.000Z" });
    expect(sortNotYetAttempted([older, newer]).map((i) => i.quiz_id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("does not mutate the input array", () => {
    const items = [item({ quiz_id: "a" }), item({ quiz_id: "b" })];
    const copy = [...items];
    sortNotYetAttempted(items);
    expect(items).toEqual(copy);
  });
});

describe("sortFinished", () => {
  it("sorts completed items by most recent completion first", () => {
    const older = item({
      quiz_id: "older",
      status: "completed",
      last_completed_at: "2026-01-01T00:00:00.000Z",
    });
    const newer = item({
      quiz_id: "newer",
      status: "completed",
      last_completed_at: "2026-02-01T00:00:00.000Z",
    });
    expect(sortFinished([older, newer]).map((i) => i.quiz_id)).toEqual(["newer", "older"]);
  });

  it("uses a missed item's window-close time as its activity timestamp", () => {
    const missed = item({
      quiz_id: "missed",
      status: "missed",
      available_until: "2026-03-01T00:00:00.000Z",
      last_completed_at: null,
    });
    const completed = item({
      quiz_id: "completed",
      status: "completed",
      last_completed_at: "2026-01-01T00:00:00.000Z",
    });
    // The missed item's window closed most recently, so it sorts first.
    expect(sortFinished([completed, missed]).map((i) => i.quiz_id)).toEqual([
      "missed",
      "completed",
    ]);
  });

  it("does not mutate the input array", () => {
    const items = [
      item({ quiz_id: "a", status: "completed", last_completed_at: "2026-01-01T00:00:00.000Z" }),
      item({ quiz_id: "b", status: "missed", available_until: "2026-02-01T00:00:00.000Z" }),
    ];
    const copy = [...items];
    sortFinished(items);
    expect(items).toEqual(copy);
  });
});

/**
 * Unit tests for the class quizzes tab's lifecycle-section grouping/sort
 * (issue #31's restructure — hidden/live/scheduled/ended sections) — no DB,
 * no React.
 */
import { describe, it, expect } from "vitest";
import { groupAssignedByState } from "@/components/teacher/classes/AssignedQuizzesSection";
import type { AssignedQuiz } from "@/lib/classes";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function allocation(overrides: Partial<AssignedQuiz> = {}): AssignedQuiz {
  return {
    quiz_id: "q1",
    title: "חידון",
    base_language: "he",
    visibility: "private",
    video_id: "v1",
    youtube_video_id: "yt1",
    video_title: "סרטון",
    tutor_mode: "hints",
    max_attempts: 2,
    published: true,
    available_from: null,
    available_until: null,
    assigned_at: "2026-06-01T00:00:00.000Z",
    question_count: 5,
    author_id: "t1",
    author_name: "מורה",
    is_own: true,
    ...overrides,
  };
}

describe("groupAssignedByState", () => {
  it("buckets each allocation by its derived lifecycle state", () => {
    const draft = allocation({ quiz_id: "draft", published: false });
    const live = allocation({ quiz_id: "live", published: true });
    const scheduled = allocation({
      quiz_id: "scheduled",
      published: true,
      available_from: "2026-07-01T00:00:00.000Z",
    });
    const done = allocation({
      quiz_id: "done",
      published: true,
      available_until: "2026-06-01T00:00:00.000Z",
    });

    const groups = groupAssignedByState([draft, live, scheduled, done], NOW);

    expect(groups.draft.map((a) => a.quiz_id)).toEqual(["draft"]);
    expect(groups.live.map((a) => a.quiz_id)).toEqual(["live"]);
    expect(groups.scheduled.map((a) => a.quiz_id)).toEqual(["scheduled"]);
    expect(groups.done.map((a) => a.quiz_id)).toEqual(["done"]);
  });

  it("an unpublished allocation lands in draft even with a past window", () => {
    const hiddenButPastWindow = allocation({
      published: false,
      available_until: "2020-01-01T00:00:00.000Z",
    });
    const groups = groupAssignedByState([hiddenButPastWindow], NOW);
    expect(groups.draft).toHaveLength(1);
    expect(groups.done).toHaveLength(0);
  });

  it("sorts live by soonest available_until first, no-deadline last", () => {
    const noDeadline = allocation({ quiz_id: "none", published: true });
    const soon = allocation({
      quiz_id: "soon",
      published: true,
      available_until: "2026-06-20T00:00:00.000Z",
    });
    const later = allocation({
      quiz_id: "later",
      published: true,
      available_until: "2026-07-20T00:00:00.000Z",
    });
    const groups = groupAssignedByState([later, noDeadline, soon], NOW);
    expect(groups.live.map((a) => a.quiz_id)).toEqual(["soon", "later", "none"]);
  });

  it("sorts scheduled by soonest available_from first", () => {
    const later = allocation({
      quiz_id: "later",
      published: true,
      available_from: "2026-08-01T00:00:00.000Z",
    });
    const soon = allocation({
      quiz_id: "soon",
      published: true,
      available_from: "2026-07-01T00:00:00.000Z",
    });
    const groups = groupAssignedByState([later, soon], NOW);
    expect(groups.scheduled.map((a) => a.quiz_id)).toEqual(["soon", "later"]);
  });

  it("sorts done by most-recently-closed first", () => {
    const older = allocation({
      quiz_id: "older",
      published: true,
      available_until: "2026-01-01T00:00:00.000Z",
    });
    const newer = allocation({
      quiz_id: "newer",
      published: true,
      available_until: "2026-05-01T00:00:00.000Z",
    });
    const groups = groupAssignedByState([older, newer], NOW);
    expect(groups.done.map((a) => a.quiz_id)).toEqual(["newer", "older"]);
  });

  it("sorts draft by newest-assigned first", () => {
    const older = allocation({
      quiz_id: "older",
      published: false,
      assigned_at: "2026-01-01T00:00:00.000Z",
    });
    const newer = allocation({
      quiz_id: "newer",
      published: false,
      assigned_at: "2026-06-01T00:00:00.000Z",
    });
    const groups = groupAssignedByState([older, newer], NOW);
    expect(groups.draft.map((a) => a.quiz_id)).toEqual(["newer", "older"]);
  });

  it("does not mutate the input array", () => {
    const items = [
      allocation({ quiz_id: "a", published: true }),
      allocation({ quiz_id: "b", published: false }),
    ];
    const copy = [...items];
    groupAssignedByState(items, NOW);
    expect(items).toEqual(copy);
  });
});

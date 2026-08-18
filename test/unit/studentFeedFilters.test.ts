/**
 * Unit tests for the student feed's search/filter/sort helpers (backlog 4.2)
 * — no DB, no React. The section-default sorts they build on
 * (`sortNotYetAttempted`/`sortFinished`) are pinned separately in
 * `studentFeedSort.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  sortFeed,
  matchesFeedFilters,
  hasActiveFilters,
  sectionOf,
  sectionSelected,
  feedClassOptions,
  feedHeading,
  EMPTY_FEED_FILTERS,
  type FeedFilters,
} from "@/lib/studentFeedFilters";
import type { StudentFeedItem, StudentFeedStatus } from "@/lib/classes";

function item(overrides: Partial<StudentFeedItem> = {}): StudentFeedItem {
  return {
    class_id: "c1",
    class_name: "כיתה א",
    teacher_name: "רונית לוי",
    quiz_id: "q1",
    title: "חידון אלגברה",
    youtube_video_id: "yt1",
    video_title: "מבוא לאלגברה",
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

function filters(overrides: Partial<FeedFilters> = {}): FeedFilters {
  return { ...EMPTY_FEED_FILTERS, ...overrides };
}

describe("sectionOf / sectionSelected", () => {
  it("buckets by status", () => {
    expect(sectionOf(item({ status: "not_started" }))).toBe("not_yet");
    expect(sectionOf(item({ status: "in_progress" }))).toBe("not_yet");
    expect(sectionOf(item({ status: "completed" }))).toBe("finished");
    expect(sectionOf(item({ status: "missed" }))).toBe("finished");
  });

  it("keeps both sections when no status is selected", () => {
    const none = new Set<StudentFeedStatus>();
    expect(sectionSelected("not_yet", none)).toBe(true);
    expect(sectionSelected("finished", none)).toBe(true);
  });

  it("drops a section no selected status belongs to", () => {
    const completedOnly = new Set<StudentFeedStatus>(["completed"]);
    expect(sectionSelected("finished", completedOnly)).toBe(true);
    expect(sectionSelected("not_yet", completedOnly)).toBe(false);
  });

  it("keeps a section when any of several selected statuses belongs to it", () => {
    const mixed = new Set<StudentFeedStatus>(["completed", "in_progress"]);
    expect(sectionSelected("not_yet", mixed)).toBe(true);
    expect(sectionSelected("finished", mixed)).toBe(true);
  });
});

describe("matchesFeedFilters", () => {
  it("matches everything when no filter is set", () => {
    expect(matchesFeedFilters(item(), EMPTY_FEED_FILTERS)).toBe(true);
  });

  it("searches the quiz title, the video title, the class and the teacher", () => {
    const it_ = item();
    expect(matchesFeedFilters(it_, filters({ search: "אלגברה" }))).toBe(true);
    expect(matchesFeedFilters(it_, filters({ search: "מבוא" }))).toBe(true);
    expect(matchesFeedFilters(it_, filters({ search: "כיתה א" }))).toBe(true);
    expect(matchesFeedFilters(it_, filters({ search: "רונית" }))).toBe(true);
    expect(matchesFeedFilters(it_, filters({ search: "גיאומטריה" }))).toBe(false);
  });

  it("searches an untitled quiz by its video title without throwing", () => {
    const untitled = item({ title: null, video_title: "היסטוריה של רומא" });
    expect(matchesFeedFilters(untitled, filters({ search: "רומא" }))).toBe(true);
  });

  it("OR-matches within the class axis", () => {
    const a = item({ class_id: "c1" });
    const b = item({ class_id: "c2" });
    const both = filters({ classes: new Set(["c1", "c2"]) });
    expect(matchesFeedFilters(a, both)).toBe(true);
    expect(matchesFeedFilters(b, both)).toBe(true);
    expect(matchesFeedFilters(b, filters({ classes: new Set(["c1"]) }))).toBe(false);
  });

  it("filters by status", () => {
    const done = item({ status: "completed" });
    expect(
      matchesFeedFilters(done, filters({ statuses: new Set(["completed"]) }))
    ).toBe(true);
    expect(matchesFeedFilters(done, filters({ statuses: new Set(["missed"]) }))).toBe(
      false
    );
  });

  it("ANDs across axes", () => {
    const it_ = item({ class_id: "c1", status: "completed" });
    expect(
      matchesFeedFilters(
        it_,
        filters({ search: "אלגברה", classes: new Set(["c2"]) })
      )
    ).toBe(false);
  });
});

describe("hasActiveFilters", () => {
  it("is false for the empty state and for a whitespace-only query", () => {
    expect(hasActiveFilters(EMPTY_FEED_FILTERS)).toBe(false);
    expect(hasActiveFilters(filters({ search: "   " }))).toBe(false);
  });

  it("is true once any axis is set", () => {
    expect(hasActiveFilters(filters({ search: "רומא" }))).toBe(true);
    expect(hasActiveFilters(filters({ classes: new Set(["c1"]) }))).toBe(true);
    expect(hasActiveFilters(filters({ statuses: new Set(["missed"]) }))).toBe(true);
  });
});

describe("sortFeed", () => {
  const early = item({
    quiz_id: "early",
    title: "אלף",
    assigned_at: "2026-01-01T00:00:00.000Z",
    available_until: "2026-03-01T00:00:00.000Z",
  });
  const late = item({
    quiz_id: "late",
    title: "בית",
    assigned_at: "2026-02-01T00:00:00.000Z",
    available_until: "2026-02-01T00:00:00.000Z",
  });
  const undated = item({
    quiz_id: "undated",
    title: "גימל",
    assigned_at: "2026-01-15T00:00:00.000Z",
    available_until: null,
  });
  const rows = [early, late, undated];
  const ids = (r: StudentFeedItem[]) => r.map((i) => i.quiz_id);

  it("'smart' uses the section's own default ordering", () => {
    expect(ids(sortFeed(rows, "smart", "not_yet"))).toEqual([
      "late",
      "early",
      "undated",
    ]);
    const finished = [
      item({ quiz_id: "older", status: "completed", last_completed_at: "2026-01-01T00:00:00.000Z" }),
      item({ quiz_id: "newer", status: "completed", last_completed_at: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(ids(sortFeed(finished, "smart", "finished"))).toEqual(["newer", "older"]);
  });

  it("sorts by soonest deadline, sinking deadline-less items to the end", () => {
    expect(ids(sortFeed(rows, "deadline_asc", "not_yet"))).toEqual([
      "late",
      "early",
      "undated",
    ]);
  });

  it("sorts by assignment date, both directions", () => {
    expect(ids(sortFeed(rows, "assigned_desc", "not_yet"))).toEqual([
      "late",
      "undated",
      "early",
    ]);
    expect(ids(sortFeed(rows, "assigned_asc", "not_yet"))).toEqual([
      "early",
      "undated",
      "late",
    ]);
  });

  it("sorts by heading, falling back to the video title for an untitled quiz", () => {
    const untitled = item({ quiz_id: "untitled", title: null, video_title: "אבג" });
    expect(ids(sortFeed([late, untitled, early], "title_asc", "not_yet"))).toEqual([
      "untitled",
      "early",
      "late",
    ]);
  });

  it("never mutates its input, under any sort", () => {
    for (const sort of ["smart", "deadline_asc", "assigned_desc", "title_asc"] as const) {
      const copy = [...rows];
      sortFeed(rows, sort, "not_yet");
      expect(rows).toEqual(copy);
    }
  });
});

describe("feedClassOptions", () => {
  it("dedupes classes across items and sorts them by name", () => {
    const rows = [
      item({ class_id: "c2", class_name: "כיתה ב" }),
      item({ class_id: "c1", class_name: "כיתה א" }),
      item({ class_id: "c2", class_name: "כיתה ב", quiz_id: "q2" }),
    ];
    expect(feedClassOptions(rows)).toEqual([
      { value: "c1", label: "כיתה א" },
      { value: "c2", label: "כיתה ב" },
    ]);
  });

  it("is empty for an empty feed", () => {
    expect(feedClassOptions([])).toEqual([]);
  });
});

describe("feedHeading", () => {
  it("prefers the quiz title, then the video title, then a generic fallback", () => {
    expect(feedHeading(item({ title: "כותרת" }))).toBe("כותרת");
    expect(feedHeading(item({ title: null, video_title: "סרטון" }))).toBe("סרטון");
    expect(feedHeading(item({ title: null, video_title: null }))).toBe("חידון");
  });
});

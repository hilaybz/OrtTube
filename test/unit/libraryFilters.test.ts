/**
 * Unit tests for the teacher quiz library's search/filter/sort helpers
 * (backlog 1.4) — no DB, no React. `sortQuizzes` never mutates its input;
 * `matchesText`/`matchesClassFilter` are pure predicates plugged into a
 * `useMemo` filter chain by `QuizLibrary.tsx`.
 */
import { describe, it, expect } from "vitest";
import {
  sortQuizzes,
  matchesText,
  matchesClassFilter,
  UNASSIGNED_CLASS,
  type SortOption,
} from "@/lib/libraryFilters";
import type { QuizAllocationTags } from "@/lib/allocations";

function quiz(created_at: string, question_count: number) {
  return { created_at, question_count };
}

describe("sortQuizzes", () => {
  const rows = [quiz("2026-01-02", 5), quiz("2026-01-03", 1), quiz("2026-01-01", 3)];

  it("sorts by date, newest first", () => {
    expect(sortQuizzes(rows, "date_desc").map((r) => r.created_at)).toEqual([
      "2026-01-03",
      "2026-01-02",
      "2026-01-01",
    ]);
  });

  it("sorts by date, oldest first", () => {
    expect(sortQuizzes(rows, "date_asc").map((r) => r.created_at)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
  });

  it("sorts by question count, most first", () => {
    expect(sortQuizzes(rows, "count_desc").map((r) => r.question_count)).toEqual([
      5, 3, 1,
    ]);
  });

  it("sorts by question count, fewest first", () => {
    expect(sortQuizzes(rows, "count_asc").map((r) => r.question_count)).toEqual([
      1, 3, 5,
    ]);
  });

  it("does not mutate the input array", () => {
    const copy = [...rows];
    sortQuizzes(rows, "date_asc" as SortOption);
    expect(rows).toEqual(copy);
  });

  it("keeps ties stable (no crash, same length) when values are equal", () => {
    const tied = [quiz("2026-01-01", 2), quiz("2026-01-01", 2)];
    expect(sortQuizzes(tied, "date_desc")).toHaveLength(2);
  });
});

describe("matchesText", () => {
  it("matches blank query against anything", () => {
    expect(matchesText(["כותרת"], "")).toBe(true);
    expect(matchesText(["כותרת"], "   ")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(matchesText(["Khan Academy"], "khan")).toBe(true);
  });

  it("matches a substring within any of several haystacks", () => {
    expect(matchesText([null, "מבוא לאלגברה", undefined], "אלגברה")).toBe(true);
  });

  it("skips null/undefined fields without matching or throwing", () => {
    expect(matchesText([null, undefined], "אלגברה")).toBe(false);
  });

  it("does not match when the query is absent from every field", () => {
    expect(matchesText(["כותרת", "ערוץ"], "לא קיים")).toBe(false);
  });
});

describe("matchesClassFilter", () => {
  const tagsWithLive: QuizAllocationTags = {
    quiz_id: "q1",
    live: [{ class_id: "c1", class_name: "כיתה א" }],
    scheduled: [],
  };
  const tagsWithScheduled: QuizAllocationTags = {
    quiz_id: "q2",
    live: [],
    scheduled: [{ class_id: "c2", class_name: "כיתה ב" }],
  };

  it("matches everything when no class is selected", () => {
    expect(matchesClassFilter(new Set(), undefined)).toBe(true);
    expect(matchesClassFilter(new Set(), tagsWithLive)).toBe(true);
  });

  it("matches a quiz live for a selected class", () => {
    expect(matchesClassFilter(new Set(["c1"]), tagsWithLive)).toBe(true);
  });

  it("matches a quiz scheduled for a selected class", () => {
    expect(matchesClassFilter(new Set(["c2"]), tagsWithScheduled)).toBe(true);
  });

  it("does not match a quiz assigned to a different class", () => {
    expect(matchesClassFilter(new Set(["c2"]), tagsWithLive)).toBe(false);
  });

  it("OR-matches across several selected classes", () => {
    expect(matchesClassFilter(new Set(["c2", "c1"]), tagsWithLive)).toBe(true);
  });

  it("UNASSIGNED_CLASS matches only a quiz with no allocation tags at all", () => {
    expect(matchesClassFilter(new Set([UNASSIGNED_CLASS]), undefined)).toBe(true);
    expect(matchesClassFilter(new Set([UNASSIGNED_CLASS]), tagsWithLive)).toBe(false);
  });

  it("combining UNASSIGNED_CLASS with a real class OR-matches both", () => {
    const selected = new Set([UNASSIGNED_CLASS, "c1"]);
    expect(matchesClassFilter(selected, undefined)).toBe(true);
    expect(matchesClassFilter(selected, tagsWithLive)).toBe(true);
    expect(matchesClassFilter(selected, tagsWithScheduled)).toBe(false);
  });
});

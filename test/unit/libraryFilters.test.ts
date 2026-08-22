/**
 * Unit tests for the teacher quiz library's search/filter/sort helpers — no
 * DB, no React. `sortQuizzes` never mutates its input; `matchesText`,
 * `matchesVisibility`, `matchesStatus` and `matchesClassFilter` are pure
 * predicates plugged into a `useMemo` filter chain by `QuizLibrary.tsx`, and
 * `normalizeStatusParam` turns the home page's `?status=` deep link into the
 * status filter's opening value.
 */
import { describe, it, expect } from "vitest";
import {
  sortQuizzes,
  matchesText,
  matchesClassFilter,
  matchesVisibility,
  matchesStatus,
  normalizeStatusParam,
  UNASSIGNED_CLASS,
  type SortOption,
} from "@/lib/libraryFilters";
import type { QuizAllocationTags } from "@/lib/allocations";

function quiz(created_at: string) {
  return { created_at };
}

describe("sortQuizzes", () => {
  const rows = [quiz("2026-01-02"), quiz("2026-01-03"), quiz("2026-01-01")];

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

  it("does not mutate the input array", () => {
    const copy = [...rows];
    sortQuizzes(rows, "date_asc" as SortOption);
    expect(rows).toEqual(copy);
  });

  it("keeps ties stable (no crash, same length) when values are equal", () => {
    const tied = [quiz("2026-01-01"), quiz("2026-01-01")];
    expect(sortQuizzes(tied, "date_desc")).toHaveLength(2);
  });
});

describe("matchesVisibility", () => {
  it("'all' matches both stored visibilities", () => {
    expect(matchesVisibility("all", "private")).toBe(true);
    expect(matchesVisibility("all", "shared")).toBe(true);
  });

  it("matches only the selected visibility", () => {
    expect(matchesVisibility("private", "private")).toBe(true);
    expect(matchesVisibility("private", "shared")).toBe(false);
    expect(matchesVisibility("shared", "shared")).toBe(true);
    expect(matchesVisibility("shared", "private")).toBe(false);
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
    closed: [],
  };
  const tagsWithScheduled: QuizAllocationTags = {
    quiz_id: "q2",
    live: [],
    scheduled: [{ class_id: "c2", class_name: "כיתה ב" }],
    closed: [],
  };
  const tagsWithClosed: QuizAllocationTags = {
    quiz_id: "q4",
    live: [],
    scheduled: [],
    closed: [{ class_id: "c1", class_name: "כיתה א" }],
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

  it("matches a quiz whose window in the selected class has already closed", () => {
    // A closed window still happened in that class. Excluding it made "class +
    // finished" — the pair a KPI-tile deep link produces — unsatisfiable.
    expect(matchesClassFilter(new Set(["c1"]), tagsWithClosed)).toBe(true);
    expect(matchesClassFilter(new Set([UNASSIGNED_CLASS]), tagsWithClosed)).toBe(false);
  });

  it("UNASSIGNED_CLASS matches a quiz with no allocation tags at all", () => {
    expect(matchesClassFilter(new Set([UNASSIGNED_CLASS]), undefined)).toBe(true);
    expect(matchesClassFilter(new Set([UNASSIGNED_CLASS]), tagsWithLive)).toBe(false);
  });

  it("UNASSIGNED_CLASS also matches a draft-only quiz (tags present, every bucket empty)", () => {
    // list_my_quiz_allocation_tags still returns a row for these — a
    // draft-only quiz must not be unreachable under every filter.
    const draftOnly = { quiz_id: "q3", live: [], scheduled: [], closed: [] };
    expect(matchesClassFilter(new Set([UNASSIGNED_CLASS]), draftOnly)).toBe(true);
    expect(matchesClassFilter(new Set(["c1"]), draftOnly)).toBe(false);
  });

  it("combining UNASSIGNED_CLASS with a real class OR-matches both", () => {
    const selected = new Set([UNASSIGNED_CLASS, "c1"]);
    expect(matchesClassFilter(selected, undefined)).toBe(true);
    expect(matchesClassFilter(selected, tagsWithLive)).toBe(true);
    expect(matchesClassFilter(selected, tagsWithScheduled)).toBe(false);
  });
});

/**
 * The status axis has to agree with the teacher home's KPI tiles exactly — the
 * tiles link INTO this filter, so a quiz counted under "חידונים פעילים" must be
 * one of the quizzes the filter then shows. Same rule as `countQuizStates`:
 * live or scheduled anywhere wins over closed elsewhere, and a quiz nobody can
 * reach yet (draft-only, or never allocated) is neither.
 */
describe("matchesStatus", () => {
  const tags = (
    parts: Partial<Pick<QuizAllocationTags, "live" | "scheduled" | "closed">>
  ): QuizAllocationTags => ({
    quiz_id: "q",
    live: [],
    scheduled: [],
    closed: [],
    ...parts,
  });
  const klass = (id: string) => [{ class_id: id, class_name: id }];

  it("'all' matches every quiz, tags or not", () => {
    expect(matchesStatus("all", undefined)).toBe(true);
    expect(matchesStatus("all", tags({}))).toBe(true);
    expect(matchesStatus("all", tags({ live: klass("c1") }))).toBe(true);
  });

  it("a live class makes a quiz active, not finished", () => {
    const t = tags({ live: klass("c1") });
    expect(matchesStatus("active", t)).toBe(true);
    expect(matchesStatus("finished", t)).toBe(false);
  });

  it("a scheduled class counts as active too", () => {
    const t = tags({ scheduled: klass("c1") });
    expect(matchesStatus("active", t)).toBe(true);
    expect(matchesStatus("finished", t)).toBe(false);
  });

  it("mid-rollout (closed in one class, live in another) is active only", () => {
    const t = tags({ live: klass("c1"), closed: klass("c2") });
    expect(matchesStatus("active", t)).toBe(true);
    expect(matchesStatus("finished", t)).toBe(false);
  });

  it("closed everywhere is finished", () => {
    const t = tags({ closed: klass("c1") });
    expect(matchesStatus("finished", t)).toBe(true);
    expect(matchesStatus("active", t)).toBe(false);
  });

  it("a draft-only quiz is neither active nor finished", () => {
    const t = tags({});
    expect(matchesStatus("active", t)).toBe(false);
    expect(matchesStatus("finished", t)).toBe(false);
  });

  it("a quiz with no allocation at all is neither", () => {
    expect(matchesStatus("active", undefined)).toBe(false);
    expect(matchesStatus("finished", undefined)).toBe(false);
  });
});

describe("normalizeStatusParam", () => {
  it("accepts the two values the home KPI tiles link with", () => {
    expect(normalizeStatusParam("active")).toBe("active");
    expect(normalizeStatusParam("finished")).toBe("finished");
  });

  it("falls back to 'all' for anything else, so a hand-edited URL still lists", () => {
    expect(normalizeStatusParam(undefined)).toBe("all");
    expect(normalizeStatusParam("")).toBe("all");
    expect(normalizeStatusParam("Active")).toBe("all");
    expect(normalizeStatusParam("draft")).toBe("all");
  });

  it("reads the first value of a repeated param", () => {
    expect(normalizeStatusParam(["finished", "active"])).toBe("finished");
    expect(normalizeStatusParam([])).toBe("all");
  });
});

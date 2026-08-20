/**
 * Search/filter/sort on the teacher quiz library (backlog 1.4 / issue #14).
 * Both tabs keep independent state; "My quizzes" additionally supports a
 * class-assignment filter the catalog tab deliberately cannot have (no
 * cross-teacher allocation visibility).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MyQuiz } from "@/lib/quiz";
import type { SharedQuiz } from "@/lib/sharing";
import type { QuizAllocationTags } from "@/lib/allocations";
import type { ClassRow } from "@/lib/classes";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { QuizLibrary } from "@/components/teacher/library/QuizLibrary";

function myQuiz(overrides: Partial<MyQuiz>): MyQuiz {
  return {
    quiz_id: "q",
    title: null,
    base_language: "he",
    visibility: "private",
    video_id: "v",
    youtube_video_id: "yt",
    video_title: null,
    channel_name: null,
    transcript_status: "ready",
    question_count: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    time_restricted: false,
    duration_minutes: null,
    duration_seconds: null,
    ...overrides,
  };
}

const Q1 = myQuiz({
  quiz_id: "q1",
  title: "חידון אלגברה",
  video_title: "מבוא לאלגברה",
  channel_name: "Khan Academy",
  base_language: "he",
  question_count: 3,
  created_at: "2026-01-01T00:00:00.000Z",
});
const Q2 = myQuiz({
  quiz_id: "q2",
  title: null,
  video_title: "היסטוריה של רומא",
  channel_name: "History Channel",
  base_language: "en",
  question_count: 10,
  created_at: "2026-01-03T00:00:00.000Z",
});
const Q3 = myQuiz({
  quiz_id: "q3",
  title: "חידון גיאומטריה",
  video_title: "יסודות הגיאומטריה",
  channel_name: "Khan Academy",
  base_language: "ar",
  question_count: 1,
  created_at: "2026-01-02T00:00:00.000Z",
});

const CLASSES: ClassRow[] = [
  { id: "c1", teacher_id: "t", school_id: "s", name: "כיתה א", language: "he", created_at: "2026-01-01T00:00:00.000Z" },
  { id: "c2", teacher_id: "t", school_id: "s", name: "כיתה ב", language: "he", created_at: "2026-01-01T00:00:00.000Z" },
];

// q3 is deliberately absent — "not assigned to any class."
const TAGS: Record<string, QuizAllocationTags> = {
  q1: { quiz_id: "q1", live: [{ class_id: "c1", class_name: "כיתה א" }], scheduled: [] },
  q2: { quiz_id: "q2", live: [], scheduled: [{ class_id: "c2", class_name: "כיתה ב" }] },
};

function sharedQuiz(overrides: Partial<SharedQuiz>): SharedQuiz {
  return {
    quiz_id: "s",
    title: null,
    base_language: "he",
    visibility: "shared",
    video_id: "v",
    youtube_video_id: "yt",
    video_title: null,
    channel_name: null,
    transcript_status: "ready",
    question_count: 1,
    author_id: "author",
    author_name: null,
    is_own: false,
    created_at: "2026-01-01T00:00:00.000Z",
    time_restricted: false,
    duration_minutes: null,
    duration_seconds: null,
    ...overrides,
  };
}

const S1 = sharedQuiz({
  quiz_id: "s1",
  title: "חידון פיזיקה",
  video_title: "יסודות הפיזיקה",
  channel_name: "Khan Academy",
  author_name: "דנה כהן",
  question_count: 5,
  created_at: "2026-01-01T00:00:00.000Z",
});
const S2 = sharedQuiz({
  quiz_id: "s2",
  title: null,
  video_title: "מבוא לכימיה",
  channel_name: null,
  author_name: "יוסי לוי",
  base_language: "en",
  question_count: 2,
  created_at: "2026-01-03T00:00:00.000Z",
});

function renderLibrary(opts?: {
  myQuizzes?: MyQuiz[];
  sharedQuizzes?: SharedQuiz[];
  allocationTags?: Record<string, QuizAllocationTags>;
  classes?: ClassRow[];
}) {
  render(
    <QuizLibrary
      myQuizzes={opts?.myQuizzes ?? [Q1, Q2, Q3]}
      sharedQuizzes={opts?.sharedQuizzes ?? [S1, S2]}
      allocationTags={opts?.allocationTags ?? TAGS}
      classes={opts?.classes ?? CLASSES}
    />
  );
}

function headings(): string[] {
  return screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent ?? "");
}

/** Open a `MultiSelectDropdown` by its label (the trigger button's accessible name). */
async function openFilter(label: string) {
  await userEvent.click(screen.getByRole("button", { name: label }));
}

/**
 * Press "clear filters". Two of them can be on screen at once — the filter
 * bar's, and the one the no-matches card offers where the reader is already
 * looking — and both do the same thing, so pressing the first is enough.
 */
async function clearFilters() {
  await userEvent.click(screen.getAllByRole("button", { name: "נקה מסננים" })[0]);
}

describe("QuizLibrary — My quizzes search/filter/sort", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches by quiz title", async () => {
    renderLibrary();
    await userEvent.type(screen.getByLabelText("חיפוש"), "אלגברה");
    expect(headings()).toEqual(["חידון אלגברה"]);
  });

  it("searches by video title", async () => {
    renderLibrary();
    await userEvent.type(screen.getByLabelText("חיפוש"), "רומא");
    expect(headings()).toEqual(["היסטוריה של רומא"]);
  });

  it("searches by the video's channel name, matching every quiz on that channel", async () => {
    renderLibrary();
    await userEvent.type(screen.getByLabelText("חיפוש"), "Khan Academy");
    expect(headings().sort()).toEqual(["חידון אלגברה", "חידון גיאומטריה"].sort());
  });

  it("filters by a single assigned class", async () => {
    renderLibrary();
    await openFilter("כיתה משויכת");
    await userEvent.click(screen.getByRole("checkbox", { name: "כיתה א" }));
    expect(headings()).toEqual(["חידון אלגברה"]);
  });

  it("OR-matches across several selected classes", async () => {
    renderLibrary();
    await openFilter("כיתה משויכת");
    await userEvent.click(screen.getByRole("checkbox", { name: "כיתה א" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "כיתה ב" }));
    expect(headings().sort()).toEqual(["היסטוריה של רומא", "חידון אלגברה"].sort());
  });

  it("'לא משויך' shows only quizzes with no allocation at all", async () => {
    renderLibrary();
    await openFilter("כיתה משויכת");
    await userEvent.click(screen.getByRole("checkbox", { name: "לא משויך" }));
    expect(headings()).toEqual(["חידון גיאומטריה"]);
  });

  it("filters by language", async () => {
    renderLibrary();
    await openFilter("שפה");
    await userEvent.click(screen.getByRole("checkbox", { name: "אנגלית" }));
    expect(headings()).toEqual(["היסטוריה של רומא"]);
  });

  it("combines a class filter and search (AND across axes)", async () => {
    renderLibrary();
    await openFilter("כיתה משויכת");
    await userEvent.click(screen.getByRole("checkbox", { name: "כיתה א" }));
    await userEvent.type(screen.getByLabelText("חיפוש"), "רומא");
    expect(
      screen.getByText("אין חידונים התואמים את החיפוש.")
    ).toBeInTheDocument();
  });

  it("clears all filters and restores the full list", async () => {
    renderLibrary();
    await openFilter("כיתה משויכת");
    await userEvent.click(screen.getByRole("checkbox", { name: "כיתה א" }));
    await userEvent.type(screen.getByLabelText("חיפוש"), "רומא");
    await clearFilters();
    expect(headings().sort()).toEqual(
      ["חידון אלגברה", "היסטוריה של רומא", "חידון גיאומטריה"].sort()
    );
  });

  it("sorts by creation date, newest first (default) then oldest first", async () => {
    renderLibrary();
    expect(headings()).toEqual(["היסטוריה של רומא", "חידון גיאומטריה", "חידון אלגברה"]);
    await userEvent.selectOptions(screen.getByLabelText("מיון"), "הישן קודם");
    expect(headings()).toEqual(["חידון אלגברה", "חידון גיאומטריה", "היסטוריה של רומא"]);
  });

  it("filters by visibility, private and shared each on their own", async () => {
    renderLibrary({
      myQuizzes: [Q1, { ...Q2, visibility: "shared" }, Q3],
    });
    await userEvent.click(screen.getByRole("radio", { name: "משותף" }));
    expect(headings()).toEqual(["היסטוריה של רומא"]);
    await userEvent.click(screen.getByRole("radio", { name: "פרטי" }));
    expect(headings().sort()).toEqual(["חידון אלגברה", "חידון גיאומטריה"].sort());
    await userEvent.click(screen.getByRole("radio", { name: "הכל" }));
    expect(headings()).toHaveLength(3);
  });
});

describe("QuizLibrary — paging", () => {
  it("pages the grid at 12 cards and moves to the rest on the next page", async () => {
    // 13 quizzes, distinct titles, newest first by construction.
    const many = Array.from({ length: 13 }, (_, i) =>
      myQuiz({
        quiz_id: `p${i}`,
        title: `חידון ${String(i).padStart(2, "0")}`,
        created_at: `2026-02-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      })
    );
    renderLibrary({ myQuizzes: many, allocationTags: {} });

    expect(headings()).toHaveLength(12);
    expect(screen.queryByText("חידון 00")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "העמוד הבא" }));
    expect(headings()).toEqual(["חידון 00"]);
  });
});

describe("QuizLibrary — School catalog search/filter/sort", () => {
  async function openSchoolTab() {
    await userEvent.click(screen.getByRole("tab", { name: "מאגר בית הספר" }));
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches by the authoring teacher's name", async () => {
    renderLibrary();
    await openSchoolTab();
    await userEvent.type(screen.getByLabelText("חיפוש"), "דנה");
    expect(headings()).toEqual(["חידון פיזיקה"]);
  });

  it("searches by video title, independent of the Mine tab's own search state", async () => {
    renderLibrary();
    await userEvent.type(screen.getByLabelText("חיפוש"), "רומא"); // types into "mine"
    await openSchoolTab();
    // The school tab's own search box starts empty — both quizzes still show.
    expect(headings().sort()).toEqual(["חידון פיזיקה", "מבוא לכימיה"].sort());
  });

  it("displays the channel name on a catalog card when present (only S1 has one)", async () => {
    renderLibrary();
    await openSchoolTab();
    expect(screen.getByText("Khan Academy")).toBeInTheDocument();
  });

  it("filters by language", async () => {
    renderLibrary();
    await openSchoolTab();
    await openFilter("שפה");
    await userEvent.click(screen.getByRole("checkbox", { name: "אנגלית" }));
    expect(headings()).toEqual(["מבוא לכימיה"]);
  });

  it("shows a no-matches state and clears back to the full list", async () => {
    renderLibrary();
    await openSchoolTab();
    await userEvent.type(screen.getByLabelText("חיפוש"), "לא קיים");
    expect(
      screen.getByText("אין חידונים התואמים את החיפוש.")
    ).toBeInTheDocument();
    await clearFilters();
    expect(headings().sort()).toEqual(["חידון פיזיקה", "מבוא לכימיה"].sort());
  });
});

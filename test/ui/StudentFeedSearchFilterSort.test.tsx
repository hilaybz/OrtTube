/**
 * Search/filter/sort on the student feed (backlog 4.2 / issue #38) — the
 * student-side counterpart of `QuizLibrarySearchFilterSort.test.tsx`. One
 * control bar governs both sections; a status filter that empties a whole
 * section drops that section rather than leaving it standing empty.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import type { StudentFeedItem } from "@/lib/classes";
import { StudentFeed } from "@/components/student/StudentFeed";

function item(overrides: Partial<StudentFeedItem>): StudentFeedItem {
  return {
    class_id: "c1",
    class_name: "כיתה א",
    teacher_name: "רונית לוי",
    quiz_id: "q",
    title: null,
    youtube_video_id: "yt",
    video_title: null,
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

/** Not yet attempted, class א, due last (so "smart" puts it second). */
const ALGEBRA = item({
  quiz_id: "algebra",
  title: "חידון אלגברה",
  video_title: "מבוא לאלגברה",
  assigned_at: "2026-01-01T00:00:00.000Z",
  available_until: "2027-03-01T00:00:00.000Z",
});
/** Not yet attempted, class ב, due first. */
const HISTORY = item({
  quiz_id: "history",
  title: null,
  video_title: "היסטוריה של רומא",
  class_id: "c2",
  class_name: "כיתה ב",
  teacher_name: "דנה כהן",
  status: "in_progress",
  assigned_at: "2026-01-03T00:00:00.000Z",
  available_until: "2027-02-01T00:00:00.000Z",
  resume_attempt_id: "a1",
});
/** Finished — completed, class א. */
const GEOMETRY = item({
  quiz_id: "geometry",
  title: "חידון גיאומטריה",
  video_title: "יסודות הגיאומטריה",
  status: "completed",
  assigned_at: "2026-01-02T00:00:00.000Z",
  last_completed_at: "2026-02-01T00:00:00.000Z",
  last_num_correct: 2,
  last_num_questions: 4,
});
/** Finished — missed, class ב, its window closed most recently. */
const CHEMISTRY = item({
  quiz_id: "chemistry",
  title: "חידון כימיה",
  class_id: "c2",
  class_name: "כיתה ב",
  teacher_name: "דנה כהן",
  status: "missed",
  is_live: false,
  attempts_left: null,
  assigned_at: "2026-01-04T00:00:00.000Z",
  available_until: "2026-03-01T00:00:00.000Z",
});

const ALL = [ALGEBRA, HISTORY, GEOMETRY, CHEMISTRY];

function renderFeed(items: StudentFeedItem[] = ALL) {
  render(<StudentFeed items={items} />);
}

/** Every visible card heading, in render order (both sections, top to bottom). */
function headings(): string[] {
  return screen.queryAllByRole("heading", { level: 3 }).map((h) => h.textContent ?? "");
}

/** The section headings still on the page. */
function sections(): string[] {
  return screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
}

async function openFilter(label: string) {
  await userEvent.click(screen.getByRole("button", { name: label }));
}

describe("StudentFeed — search", () => {
  it("searches by quiz title", async () => {
    renderFeed();
    await userEvent.type(screen.getByLabelText("חיפוש"), "אלגברה");
    expect(headings()).toEqual(["חידון אלגברה"]);
  });

  it("searches by video title, including an untitled quiz", async () => {
    renderFeed();
    await userEvent.type(screen.getByLabelText("חיפוש"), "רומא");
    expect(headings()).toEqual(["היסטוריה של רומא"]);
  });

  it("searches by teacher name, across both sections at once", async () => {
    renderFeed();
    await userEvent.type(screen.getByLabelText("חיפוש"), "דנה");
    expect(headings()).toEqual(["היסטוריה של רומא", "חידון כימיה"]);
  });

  it("searches by class name", async () => {
    renderFeed();
    await userEvent.type(screen.getByLabelText("חיפוש"), "כיתה א");
    expect(headings()).toEqual(["חידון אלגברה", "חידון גיאומטריה"]);
  });

  it("tells the student when nothing matches, in each section", async () => {
    renderFeed();
    await userEvent.type(screen.getByLabelText("חיפוש"), "לא קיים");
    expect(headings()).toEqual([]);
    expect(screen.getAllByText("אין חידונים התואמים את החיפוש.")).toHaveLength(2);
  });
});

describe("StudentFeed — filters", () => {
  it("filters by class", async () => {
    renderFeed();
    await openFilter("כיתה");
    await userEvent.click(screen.getByRole("checkbox", { name: "כיתה ב" }));
    expect(headings()).toEqual(["היסטוריה של רומא", "חידון כימיה"]);
  });

  it("OR-matches across several selected classes", async () => {
    renderFeed();
    await openFilter("כיתה");
    await userEvent.click(screen.getByRole("checkbox", { name: "כיתה א" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "כיתה ב" }));
    expect(headings()).toHaveLength(4);
  });

  it("hides the class filter for a student with only one class", () => {
    renderFeed([ALGEBRA, GEOMETRY]);
    expect(screen.queryByRole("button", { name: "כיתה" })).not.toBeInTheDocument();
  });

  it("filters by status, dropping the section that status cannot appear in", async () => {
    renderFeed();
    await openFilter("מצב");
    await userEvent.click(screen.getByRole("checkbox", { name: "פוספס" }));
    expect(headings()).toEqual(["חידון כימיה"]);
    expect(sections()).toEqual(["הושלמו"]);
  });

  it("keeps both sections when the selected statuses span them", async () => {
    renderFeed();
    await openFilter("מצב");
    await userEvent.click(screen.getByRole("checkbox", { name: "בתהליך" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "הושלם" }));
    expect(sections()).toEqual(["טרם ניסית", "הושלמו"]);
    expect(headings()).toEqual(["היסטוריה של רומא", "חידון גיאומטריה"]);
  });

  it("ANDs search with a class filter", async () => {
    renderFeed();
    await openFilter("כיתה");
    await userEvent.click(screen.getByRole("checkbox", { name: "כיתה א" }));
    await userEvent.type(screen.getByLabelText("חיפוש"), "רומא");
    expect(headings()).toEqual([]);
  });

  it("clears every filter and restores the full feed", async () => {
    renderFeed();
    await openFilter("כיתה");
    await userEvent.click(screen.getByRole("checkbox", { name: "כיתה ב" }));
    await userEvent.type(screen.getByLabelText("חיפוש"), "כימיה");
    await userEvent.click(screen.getByRole("button", { name: "נקה מסננים" }));
    expect(headings()).toHaveLength(4);
    expect(sections()).toEqual(["טרם ניסית", "הושלמו"]);
  });

  it("offers a clear button only while a filter is active", async () => {
    renderFeed();
    expect(screen.queryByRole("button", { name: "נקה מסננים" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("חיפוש"), "כימיה");
    expect(screen.getByRole("button", { name: "נקה מסננים" })).toBeInTheDocument();
  });
});

describe("StudentFeed — sort", () => {
  it("defaults to each section's own ordering: deadline first, then recent activity", () => {
    renderFeed();
    expect(headings()).toEqual([
      "היסטוריה של רומא", // due first
      "חידון אלגברה",
      "חידון כימיה", // window closed most recently
      "חידון גיאומטריה",
    ]);
  });

  it("sorts by assignment date, both directions, in both sections", async () => {
    renderFeed();
    await userEvent.selectOptions(
      screen.getByLabelText("מיון"),
      "תאריך הקצאה (החדש קודם)"
    );
    expect(headings()).toEqual([
      "היסטוריה של רומא",
      "חידון אלגברה",
      "חידון כימיה",
      "חידון גיאומטריה",
    ]);
    await userEvent.selectOptions(
      screen.getByLabelText("מיון"),
      "תאריך הקצאה (הישן קודם)"
    );
    expect(headings()).toEqual([
      "חידון אלגברה",
      "היסטוריה של רומא",
      "חידון גיאומטריה",
      "חידון כימיה",
    ]);
  });

  it("sorts by name, using the video title for an untitled quiz", async () => {
    renderFeed();
    await userEvent.selectOptions(screen.getByLabelText("מיון"), "שם החידון (א׳–ת׳)");
    expect(headings()).toEqual([
      "היסטוריה של רומא",
      "חידון אלגברה",
      "חידון גיאומטריה",
      "חידון כימיה",
    ]);
  });

  it("keeps a chosen sort applied while filters narrow the feed", async () => {
    renderFeed();
    await userEvent.selectOptions(
      screen.getByLabelText("מיון"),
      "תאריך הקצאה (הישן קודם)"
    );
    await openFilter("כיתה");
    await userEvent.click(screen.getByRole("checkbox", { name: "כיתה א" }));
    expect(headings()).toEqual(["חידון אלגברה", "חידון גיאומטריה"]);
  });
});

describe("StudentFeed — empty feed", () => {
  it("shows no control bar at all when nothing is assigned", () => {
    renderFeed([]);
    expect(screen.queryByLabelText("חיפוש")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("מיון")).not.toBeInTheDocument();
    expect(sections()).toEqual(["טרם ניסית", "הושלמו"]);
  });
});

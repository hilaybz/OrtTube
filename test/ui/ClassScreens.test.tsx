/**
 * The two panels of a class page, after the revamp.
 *
 * What is asserted here is mostly what is NOT there any more: a teacher does
 * not manage membership (no add/remove student), a row does not repeat its
 * section's name as a "פעיל" tag or carry a bare attempts count, and the
 * withdrawn group has no heading and no analytics. The rest pins the
 * replacements — one status sentence per row, icon actions with accessible
 * names, search + filter, and a student row that leads to that student's
 * analytics.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import type { AssignedQuiz, ClassRoster } from "@/lib/classes";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { RosterSection } from "@/components/teacher/classes/RosterSection";
import { AssignedQuizzesSection } from "@/components/teacher/classes/AssignedQuizzesSection";

// ── Roster ───────────────────────────────────────────────────────────────────

const ROSTER: ClassRoster = {
  members: [
    {
      student_id: "s1",
      email: "dana@example.com",
      display_name: "דנה כהן",
      joined_at: "2026-01-05T00:00:00.000Z",
    },
    {
      student_id: "s2",
      email: "yossi@example.com",
      display_name: "יוסי לוי",
      joined_at: "2026-02-05T00:00:00.000Z",
    },
  ],
  invites: [{ email: "pending@example.com", created_at: "2026-03-01T00:00:00.000Z" }],
};

describe("RosterSection", () => {
  it("offers no way to add or remove a student", () => {
    render(<RosterSection roster={ROSTER} />);
    expect(screen.queryByLabelText("אימייל התלמיד/ה")).toBeNull();
    expect(screen.queryByRole("button", { name: "הוספה" })).toBeNull();
    expect(screen.queryByRole("button", { name: "הסרה" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ביטול הזמנה" })).toBeNull();
  });

  it("drops the join-date column and sends a student to their analytics", () => {
    render(<RosterSection roster={ROSTER} />);
    expect(screen.queryByText("צורף/ה בתאריך")).toBeNull();
    expect(screen.getByRole("link", { name: /דנה כהן/ })).toHaveAttribute(
      "href",
      "/dashboard/analytics?scope=student&id=s1"
    );
  });

  it("still shows pending invites, since they explain a missing student", () => {
    render(<RosterSection roster={ROSTER} />);
    expect(screen.getByText("pending@example.com")).toBeInTheDocument();
  });

  it("searches the roster by name once it is long enough to need it", async () => {
    const many: ClassRoster = {
      members: Array.from({ length: 8 }, (_, i) => ({
        student_id: `s${i}`,
        email: `student${i}@example.com`,
        display_name: `תלמיד ${i}`,
        joined_at: "2026-01-01T00:00:00.000Z",
      })),
      invites: [],
    };
    render(<RosterSection roster={many} />);
    await userEvent.type(screen.getByLabelText("חיפוש תלמיד/ה"), "תלמיד 3");
    expect(screen.getByRole("link", { name: /תלמיד 3/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /תלמיד 4/ })).toBeNull();
  });
});

// ── Assigned quizzes ─────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;

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
    question_count: 5,
    assigned_at: "2026-06-01T00:00:00.000Z",
    author_id: "t1",
    author_name: "מורה",
    is_own: true,
    ...overrides,
  };
}

const OPEN = allocation({
  quiz_id: "open",
  title: "חידון פעיל",
  available_until: new Date(Date.now() + 3 * DAY).toISOString(),
});
const ENDED = allocation({
  quiz_id: "ended",
  title: "חידון שהסתיים",
  available_until: new Date(Date.now() - 3 * DAY).toISOString(),
});
const HIDDEN = allocation({
  quiz_id: "hidden",
  title: "חידון מוסתר",
  published: false,
});

function renderAssigned(assigned: AssignedQuiz[] = [OPEN, ENDED, HIDDEN]) {
  render(
    <AssignedQuizzesSection classId="c1" assigned={assigned} myQuizzes={[]} />
  );
}

/** The <li> a given quiz title lives in. */
function row(title: string): HTMLElement {
  const heading = screen.getByText(title);
  const li = heading.closest("li");
  if (!li) throw new Error(`no row for ${title}`);
  return li;
}

describe("AssignedQuizzesSection rows", () => {
  it("replaces the state tag and the raw window with one status sentence", () => {
    renderAssigned();
    expect(within(row("חידון פעיל")).getByText("נסגר בעוד 3 ימים")).toBeInTheDocument();
    expect(
      within(row("חידון שהסתיים")).getByText("הסתיים לפני 3 ימים")
    ).toBeInTheDocument();
    expect(within(row("חידון מוסתר")).getByText("מוסתר מתלמידים")).toBeInTheDocument();
    // The old tags: a state noun duplicating the section, and a bare count.
    expect(screen.queryByText("פעיל")).toBeNull();
    expect(screen.queryByText("ניסיונות")).toBeNull();
    expect(screen.queryByText(/^2 ניסיונות$/)).toBeNull();
  });

  it("turns the row actions into labelled icon buttons", () => {
    renderAssigned([OPEN]);
    const open = within(row("חידון פעיל"));
    expect(open.getByRole("button", { name: "עריכת ההקצאה" })).toBeInTheDocument();
    expect(open.getByRole("button", { name: "הסתרה מתלמידים" })).toBeInTheDocument();
    expect(open.getByRole("button", { name: "סיום השאלון עכשיו" })).toBeInTheDocument();
    expect(open.getByRole("button", { name: "ביטול הקצאה" })).toBeInTheDocument();
    expect(open.getByRole("link", { name: "אנליטיקה של החידון בכיתה" })).toHaveAttribute(
      "href",
      "/dashboard/classes/c1/analytics/open"
    );
  });

  it("keeps the withdrawn group unheaded, and out of analytics", () => {
    renderAssigned();
    expect(screen.getByRole("heading", { name: "פעילים" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "הסתיימו" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "מוסתרים" })).toBeNull();
    expect(
      within(row("חידון מוסתר")).queryByRole("link", {
        name: "אנליטיקה של החידון בכיתה",
      })
    ).toBeNull();
    // Nor can a quiz nobody can see be ended.
    expect(
      within(row("חידון מוסתר")).queryByRole("button", { name: "סיום השאלון עכשיו" })
    ).toBeNull();
  });

  it("confirms before unassigning", async () => {
    renderAssigned([OPEN]);
    await userEvent.click(
      within(row("חידון פעיל")).getByRole("button", { name: "ביטול הקצאה" })
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(/החידון יוסר מהכיתה/);
  });
});

describe("AssignedQuizzesSection search and filter", () => {
  it("filters down to the ended quizzes", async () => {
    renderAssigned();
    await userEvent.click(screen.getByRole("radio", { name: "הסתיימו" }));
    expect(screen.getByText("חידון שהסתיים")).toBeInTheDocument();
    expect(screen.queryByText("חידון פעיל")).toBeNull();
    expect(screen.queryByText("חידון מוסתר")).toBeNull();
  });

  it("searches across every section at once", async () => {
    renderAssigned();
    await userEvent.type(screen.getByLabelText("חיפוש חידון"), "מוסתר");
    expect(screen.getByText("חידון מוסתר")).toBeInTheDocument();
    expect(screen.queryByText("חידון פעיל")).toBeNull();
  });

  it("says so when nothing matches", async () => {
    renderAssigned();
    await userEvent.type(screen.getByLabelText("חיפוש חידון"), "אין כזה");
    expect(screen.getByText("אין חידון שתואם את החיפוש או הסינון.")).toBeInTheDocument();
  });
});

/**
 * The per-student table in the class analytics view.
 *
 * Its one structural change is the point of these tests: the per-quiz results
 * moved from a COLUMN PER QUIZ (a table whose width grew with everything a
 * teacher had ever assigned) to a single quiz-picker column. So what has to hold
 * is that the table's width no longer depends on the assignment count, that the
 * picker actually swaps which quiz the column reports, and that each row leads to
 * that student's analytics — the link Section 4's class roster also relies on.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RosterTable } from "@/components/teacher/RosterTable";
import type { ClassRosterProgress } from "@/lib/analyticsProgress";

const QUIZ_A = "11111111-1111-1111-1111-111111111111";
const QUIZ_B = "22222222-2222-2222-2222-222222222222";
const ALICE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function roster(): ClassRosterProgress {
  return {
    class_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    summary: {
      member_count: 2,
      total_assigned: 2,
      possible_completions: 4,
      quizzes_completed_total: 3,
      average_best_score: 0.75,
    },
    members: [
      {
        student_id: ALICE,
        display_name: "Alice Adams",
        email: "alice@example.com",
        total_assigned: 2,
        quizzes_completed: 2,
        average_best_score: 0.9,
        quizzes: [
          {
            quiz_id: QUIZ_A,
            title: "Photosynthesis",
            completed: true,
            attempt_count: 1,
            best_num_correct: 5,
            best_num_questions: 5,
            best_score: 1,
          },
          {
            quiz_id: QUIZ_B,
            title: "Respiration",
            completed: true,
            attempt_count: 2,
            best_num_correct: 4,
            best_num_questions: 5,
            best_score: 0.8,
          },
        ],
      },
      {
        student_id: BOB,
        display_name: "Bob Brown",
        email: "bob@example.com",
        total_assigned: 2,
        quizzes_completed: 1,
        average_best_score: 0.6,
        quizzes: [
          {
            quiz_id: QUIZ_A,
            title: "Photosynthesis",
            completed: true,
            attempt_count: 1,
            best_num_correct: 3,
            best_num_questions: 5,
            best_score: 0.6,
          },
          {
            quiz_id: QUIZ_B,
            title: "Respiration",
            completed: false,
            attempt_count: 0,
            best_num_correct: null,
            best_num_questions: null,
            best_score: null,
          },
        ],
      },
    ],
  };
}

function rowFor(name: string): HTMLElement {
  return screen.getByRole("rowheader", { name: new RegExp(name) }).closest("tr")!;
}

describe("RosterTable (class analytics)", () => {
  it("renders one result column, not one per assigned quiz", () => {
    render(<RosterTable roster={roster()} />);
    // תלמיד/ה · הושלמו · ציון ממוצע · <picked quiz> · (actions)
    const header = screen.getAllByRole("row")[0];
    expect(within(header).getAllByRole("columnheader")).toHaveLength(5);
  });

  it("shows the first quiz's result per student until the teacher picks another", () => {
    render(<RosterTable roster={roster()} />);
    expect(within(rowFor("Alice")).getByText("5/5")).toBeInTheDocument();
    expect(within(rowFor("Bob")).getByText("3/5")).toBeInTheDocument();
  });

  it("swaps the column to the picked quiz", async () => {
    const user = userEvent.setup();
    render(<RosterTable roster={roster()} />);

    await user.selectOptions(
      screen.getByLabelText("תוצאה בחידון"),
      "Respiration"
    );

    expect(within(rowFor("Alice")).getByText("4/5")).toBeInTheDocument();
    // Bob never finished this one: an em dash, with the reason for a screen reader.
    const bobRow = rowFor("Bob");
    expect(within(bobRow).queryByText("3/5")).not.toBeInTheDocument();
    expect(within(bobRow).getByText("לא הושלם")).toBeInTheDocument();
  });

  it("names the picked quiz in the column header", async () => {
    const user = userEvent.setup();
    render(<RosterTable roster={roster()} />);
    expect(
      screen.getByRole("columnheader", { name: "Photosynthesis" })
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText("תוצאה בחידון"),
      "Respiration"
    );
    expect(
      screen.getByRole("columnheader", { name: "Respiration" })
    ).toBeInTheDocument();
  });

  it("links each student to their own analytics view", () => {
    render(<RosterTable roster={roster()} />);
    const link = within(rowFor("Alice")).getByRole("link", { name: "Alice Adams" });
    expect(link).toHaveAttribute(
      "href",
      `/dashboard/analytics?scope=student&id=${ALICE}`
    );
  });

  it("filters the roster by name and says so when nothing matches", async () => {
    const user = userEvent.setup();
    render(<RosterTable roster={roster()} />);

    await user.type(screen.getByLabelText("חיפוש תלמיד/ה"), "bob");
    expect(screen.queryByText("Alice Adams")).not.toBeInTheDocument();
    expect(screen.getByText("Bob Brown")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("חיפוש תלמיד/ה"));
    await user.type(screen.getByLabelText("חיפוש תלמיד/ה"), "zzz");
    expect(
      screen.getByText("לא נמצא/ה תלמיד/ה בשם הזה בכיתה.")
    ).toBeInTheDocument();
  });

  it("explains an empty class instead of rendering an empty table", () => {
    const empty = roster();
    empty.members = [];
    render(<RosterTable roster={empty} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/עדיין אין תלמידים בכיתה/)).toBeInTheDocument();
  });
});

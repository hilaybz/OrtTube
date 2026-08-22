/**
 * A feed card as the student reads it: where it goes and what its status block
 * says. The derivations themselves are unit-tested in
 * `test/unit/studentQuizCardStatus.test.ts`; what matters here is that the card
 * actually wires them — in particular that a finished quiz with nothing left to
 * attempt links straight to its results rather than to a player screen whose
 * only purpose would be a button to those same results.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { QuizCard } from "@/components/student/QuizCard";
import type { StudentFeedItem } from "@/lib/classes";

function item(overrides: Partial<StudentFeedItem> = {}): StudentFeedItem {
  return {
    class_id: "c1",
    class_name: "כיתה א",
    teacher_name: "רונית לוי",
    quiz_id: "q1",
    title: "חידון אלגברה",
    youtube_video_id: "yt1",
    video_title: "מבוא לאלגברה",
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

describe("QuizCard (student feed)", () => {
  it("links a finished quiz with no retake straight to its results", () => {
    render(
      <QuizCard
        item={item({
          status: "completed",
          attempts_left: 0,
          last_num_correct: 8,
          last_num_questions: 10,
          last_completed_at: "2026-03-10T18:00:00.000Z",
        })}
      />
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/student/quiz/c1/q1/results"
    );
    expect(screen.getByText("צפייה בתוצאות")).toBeInTheDocument();
    // The grade leads the status block; the date is the quiet half of it.
    expect(screen.getByText("ציון 80")).toBeInTheDocument();
    expect(screen.getByText("הוגש ב-10.3")).toBeInTheDocument();
  });

  it("still opens the player when a retake is left", () => {
    render(
      <QuizCard item={item({ status: "completed", attempts_left: 1, is_live: true })} />
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/student/quiz/c1/q1");
    expect(screen.getByText("ניסיון נוסף")).toBeInTheDocument();
  });

  it("shows a deadline, not a bare date, on a quiz still to submit", () => {
    // Rendered with the real clock, so assert on the shape rather than the
    // wording a specific "now" would produce: a far-future deadline is stated
    // as a deadline with the hour it closes at.
    render(
      <QuizCard item={item({ status: "not_started", available_until: "2099-01-01T10:00:00.000Z" })} />
    );
    expect(screen.getByText(/^מועד הגשה · /)).toBeInTheDocument();
  });

  it("says a quiz with no deadline has none", () => {
    render(<QuizCard item={item({ status: "not_started", available_until: null })} />);
    expect(screen.getByText("ללא מועד הגשה")).toBeInTheDocument();
  });

  it("leaves a missed quiz unlinked — there is nowhere for it to go", () => {
    render(
      <QuizCard
        item={item({ status: "missed", available_until: "2026-03-10T18:00:00.000Z" })}
      />
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("לא הוגש")).toBeInTheDocument();
    expect(screen.getByText("נסגר ב-10.3")).toBeInTheDocument();
  });
});

/**
 * The student feed's greeting panel. It mirrors the teacher overview's header
 * in shape and register but answers a student's question rather than a
 * teacher's: not "how many classes do I run?" but "what do I owe, and what is
 * due first?". These tests pin that content — and the restraint of *not*
 * manufacturing a "next up" when nothing has a deadline to be next by.
 *
 * The clock is fixed at 11:00 Israeli time on Saturday 14 March 2026, since the
 * greeting and the date are both school-local.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StudentWelcome } from "@/components/student/StudentWelcome";
import type { StudentFeedItem } from "@/lib/classes";

const NOW = new Date("2026-03-14T09:00:00.000Z");

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

describe("StudentWelcome", () => {
  it("greets by name for the school's time of day, with today's date", () => {
    render(<StudentWelcome name="דנה" items={[]} now={NOW} />);
    expect(
      screen.getByRole("heading", { name: "בוקר טוב, דנה" })
    ).toBeInTheDocument();
    expect(screen.getByText("יום שבת, 14 במרץ")).toBeInTheDocument();
  });

  it("greets without a name when there is none, rather than an empty comma", () => {
    render(<StudentWelcome name={null} items={[]} now={NOW} />);
    expect(screen.getByRole("heading", { name: "בוקר טוב" })).toBeInTheDocument();
  });

  it("counts what is still owed — not classes, not finished quizzes", () => {
    render(
      <StudentWelcome
        name="דנה"
        items={[
          item({ quiz_id: "a", status: "not_started" }),
          item({ quiz_id: "b", status: "in_progress" }),
          item({ quiz_id: "c", status: "completed" }),
        ]}
        now={NOW}
      />
    );
    expect(screen.getByText("2 חידונים ממתינים לך.")).toBeInTheDocument();
  });

  it("says so when nothing is waiting", () => {
    render(
      <StudentWelcome name="דנה" items={[item({ status: "completed" })]} now={NOW} />
    );
    expect(screen.getByText("אין חידונים שממתינים לך כרגע.")).toBeInTheDocument();
  });

  it("puts the nearest deadline in front of the student, with its own link", () => {
    render(
      <StudentWelcome
        name="דנה"
        items={[
          item({
            quiz_id: "far",
            title: "חידון רחוק",
            available_until: "2026-03-20T16:00:00.000Z",
          }),
          item({
            quiz_id: "near",
            title: "חידון קרוב",
            available_until: "2026-03-15T16:00:00.000Z",
          }),
        ]}
        now={NOW}
      />
    );
    const link = screen.getByRole("link", { name: /חידון קרוב/ });
    expect(link).toHaveAttribute("href", "/student/quiz/c1/near");
    // The "when" travels with the "what".
    expect(link).toHaveTextContent("מחר");
    expect(screen.queryByText(/חידון רחוק/)).not.toBeInTheDocument();
  });

  it("offers no next-up link when nothing pending has a deadline", () => {
    render(
      <StudentWelcome name="דנה" items={[item({ available_until: null })]} now={NOW} />
    );
    expect(screen.getByText("חידון אחד ממתין לך.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

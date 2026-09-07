import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { StatTile } from "@/components/teacher/StatTile";
import { ClassCard } from "@/components/teacher/overview/ClassCard";
import { FinishedQuizCard } from "@/components/teacher/overview/FinishedQuizCard";
import { WelcomeHeader } from "@/components/teacher/overview/WelcomeHeader";
import type { ClassSummary } from "@/components/teacher/overview/aggregate";

const summary: ClassSummary = {
  id: "c1",
  name: "ט'1",
  memberCount: 28,
  activeQuizzes: 2,
  finishedQuizzes: 5,
};

describe("ClassCard", () => {
  it("shows the roster and the class's own active/finished split", () => {
    render(<ClassCard summary={summary} />);
    for (const label of ["תלמידים", "חידונים פעילים", "חידונים שהסתיימו"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("28")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("offers the class and its analytics as two separate, un-nested links", () => {
    const { container } = render(<ClassCard summary={summary} />);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/dashboard/classes/c1?from=overview",
      "/dashboard/analytics?scope=class&id=c1&from=overview",
    ]);
    expect(container.querySelector("a a")).toBeNull();
    expect(
      screen.getByRole("link", { name: "אנליטיקה של ט'1" })
    ).toBeInTheDocument();
  });
});

describe("FinishedQuizCard", () => {
  const quiz = {
    key: "c1:q1",
    quizId: "q1",
    classId: "c1",
    className: "ט'1",
    title: "מלחמת העולם",
    videoTitle: "סרטון",
    youtubeVideoId: "yt1",
    questionCount: 5,
    closedAt: "2026-08-19T20:00:00.000Z",
  };

  it("reads the closing time as a relative phrase beside its date", () => {
    render(<FinishedQuizCard quiz={quiz} now={new Date("2026-08-20T09:00:00.000Z")} />);
    expect(screen.getByText("נסגר אתמול")).toBeInTheDocument();
    expect(screen.getByText("· 19/08/2026")).toBeInTheDocument();
    expect(screen.getByText("ט'1")).toBeInTheDocument();
  });

  it("leads into that class's results for the quiz, naming the overview as origin", () => {
    render(<FinishedQuizCard quiz={quiz} now={new Date("2026-08-20T09:00:00.000Z")} />);
    expect(
      screen.getByRole("link", { name: "תוצאות מלחמת העולם בט'1" })
    ).toHaveAttribute(
      "href",
      "/dashboard/analytics?scope=quiz&id=q1&class=c1&from=overview"
    );
  });
});

describe("WelcomeHeader", () => {
  it("sends the \"+\" to the new-quiz page with the overview as its origin", () => {
    render(<WelcomeHeader name="דנה" subtitle="הכול רגוע." now={new Date("2026-08-20T09:00:00.000Z")} />);
    expect(screen.getByRole("link", { name: "חידון חדש" })).toHaveAttribute(
      "href",
      "/dashboard/quizzes/new?from=overview"
    );
  });
});

describe("StatTile", () => {
  it("makes the whole tile a link, with a forward affordance, when it drills in", () => {
    render(
      <StatTile
        label="חידונים פעילים"
        value={3}
        icon="play"
        href="/dashboard/quizzes?status=active"
      />
    );
    expect(
      screen.getByRole("link", { name: /חידונים פעילים/ })
    ).toHaveAttribute("href", "/dashboard/quizzes?status=active");
  });

  it("stays a plain figure when the metric has nowhere to go", () => {
    const { container } = render(<StatTile label="תלמידים" value={42} icon="users" />);
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});

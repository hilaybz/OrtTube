import { describe, it, expect } from "vitest";
import {
  countQuizStates,
  recentlyFinishedQuizzes,
  summarizeClass,
  totalsFromSummaries,
  formatShortDate,
  quizHeading,
  greetingFor,
  firstName,
  RECENTLY_FINISHED_LOOKBACK_DAYS,
  type ClassAssignments,
} from "@/components/teacher/overview/aggregate";
import type { ClassRow, AssignedQuiz } from "@/lib/classes";
import type { ClassStats } from "@/lib/analytics";

const NOW = new Date("2026-08-20T09:00:00.000Z");

function klass(id: string, name = `כיתה ${id}`): ClassRow {
  return {
    id,
    teacher_id: "t1",
    school_id: "s1",
    name,
    language: "he",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function allocation(over: Partial<AssignedQuiz> & { quiz_id: string }): AssignedQuiz {
  return {
    title: "חידון",
    base_language: "he",
    visibility: "private",
    video_id: "v1",
    youtube_video_id: "yt1",
    video_title: "סרטון",
    tutor_mode: "hints",
    max_attempts: null,
    published: true,
    available_from: null,
    available_until: null,
    assigned_at: "2026-08-01T00:00:00.000Z",
    question_count: 5,
    author_id: "t1",
    author_name: "מורה",
    is_own: true,
    ...over,
  };
}

function stats(over: Partial<ClassStats> & { class_id: string }): ClassStats {
  return { current_member_count: 0, quizzes: [], ...over };
}

function quizStat(over: Partial<ClassStats["quizzes"][number]> = {}) {
  return {
    quiz_id: "q",
    title: null,
    deleted: false,
    tutor_mode: "hints" as const,
    max_attempts: null,
    attempt_count: 0,
    completion_count: 0,
    average_score: null,
    members_completed: 0,
    current_member_count: 0,
    ...over,
  };
}

describe("summarizeClass", () => {
  it("counts only currently-assigned quizzes and their completions", () => {
    const summary = summarizeClass(
      klass("c1", "ט'1"),
      stats({
        class_id: "c1",
        current_member_count: 28,
        quizzes: [
          quizStat({ quiz_id: "q1", completion_count: 12 }),
          quizStat({ quiz_id: "q2", completion_count: 5 }),
          // A soft-deleted quiz contributes nothing at all.
          quizStat({ quiz_id: "q3", completion_count: 99, deleted: true }),
        ],
      })
    );
    expect(summary).toEqual({
      id: "c1",
      name: "ט'1",
      memberCount: 28,
      assignedCount: 2,
      completions: 17,
    });
  });

  it("degrades to zeroes when a class's stats could not be read", () => {
    expect(summarizeClass(klass("c1"), null)).toMatchObject({
      memberCount: 0,
      assignedCount: 0,
      completions: 0,
    });
  });
});

describe("countQuizStates", () => {
  const open = allocation({
    quiz_id: "open",
    available_until: "2026-09-01T00:00:00.000Z",
  });
  const closed = allocation({
    quiz_id: "closed",
    available_until: "2026-08-18T00:00:00.000Z",
  });
  const draft = allocation({ quiz_id: "draft", published: false });
  const scheduled = allocation({
    quiz_id: "scheduled",
    available_from: "2026-09-01T00:00:00.000Z",
  });

  it("counts distinct quizzes by lifecycle, not allocations", () => {
    const assignments: ClassAssignments[] = [
      { klass: klass("c1"), quizzes: [open, closed] },
      // The same open quiz in a second class is still one open quiz.
      { klass: klass("c2"), quizzes: [open, scheduled, draft] },
    ];
    expect(countQuizStates(assignments, NOW)).toEqual({
      openQuizzes: 2, // open + scheduled
      finishedQuizzes: 1, // closed
    });
  });

  it("never counts a mid-rollout quiz as both open and finished", () => {
    const assignments: ClassAssignments[] = [
      { klass: klass("c1"), quizzes: [allocation({ quiz_id: "q", available_until: "2026-08-18T00:00:00.000Z" })] },
      { klass: klass("c2"), quizzes: [allocation({ quiz_id: "q", available_until: "2026-09-01T00:00:00.000Z" })] },
    ];
    expect(countQuizStates(assignments, NOW)).toEqual({
      openQuizzes: 1,
      finishedQuizzes: 0,
    });
  });

  it("ignores drafts entirely", () => {
    expect(
      countQuizStates([{ klass: klass("c1"), quizzes: [draft] }], NOW)
    ).toEqual({ openQuizzes: 0, finishedQuizzes: 0 });
  });
});

describe("totalsFromSummaries", () => {
  it("sums classes and students and carries the quiz-state counts through", () => {
    const summaries = [
      summarizeClass(klass("c1"), stats({ class_id: "c1", current_member_count: 28 })),
      summarizeClass(klass("c2"), stats({ class_id: "c2", current_member_count: 14 })),
    ];
    expect(
      totalsFromSummaries(summaries, { openQuizzes: 3, finishedQuizzes: 2 })
    ).toEqual({
      classCount: 2,
      studentCount: 42,
      openQuizzes: 3,
      finishedQuizzes: 2,
    });
  });
});

describe("recentlyFinishedQuizzes", () => {
  const inWindow = allocation({
    quiz_id: "recent",
    title: "מלחמת העולם",
    available_until: "2026-08-18T10:00:00.000Z",
  });
  const older = allocation({
    quiz_id: "old",
    available_until: "2026-08-01T10:00:00.000Z",
  });
  const stillOpen = allocation({
    quiz_id: "live",
    available_until: "2026-09-01T10:00:00.000Z",
  });

  it("keeps only windows that closed inside the lookback, newest first", () => {
    const justInside = allocation({
      quiz_id: "edge",
      available_until: new Date(
        NOW.getTime() - (RECENTLY_FINISHED_LOOKBACK_DAYS * 24 - 1) * 60 * 60 * 1000
      ).toISOString(),
    });
    const rows = recentlyFinishedQuizzes(
      [{ klass: klass("c1", "ט'1"), quizzes: [older, inWindow, stillOpen, justInside] }],
      NOW
    );
    expect(rows.map((r) => r.quizId)).toEqual(["recent", "edge"]);
    expect(rows[0]).toMatchObject({
      key: "c1:recent",
      classId: "c1",
      className: "ט'1",
      title: "מלחמת העולם",
      closedAt: "2026-08-18T10:00:00.000Z",
    });
  });

  it("reports the same quiz once per class, since each window closes on its own day", () => {
    const rows = recentlyFinishedQuizzes(
      [
        { klass: klass("c1"), quizzes: [inWindow] },
        {
          klass: klass("c2"),
          quizzes: [allocation({ quiz_id: "recent", available_until: "2026-08-19T10:00:00.000Z" })],
        },
      ],
      NOW
    );
    expect(rows.map((r) => r.key)).toEqual(["c2:recent", "c1:recent"]);
  });

  it("excludes an unpublished allocation even with a past window", () => {
    expect(
      recentlyFinishedQuizzes(
        [
          {
            klass: klass("c1"),
            quizzes: [allocation({ quiz_id: "d", published: false, available_until: "2026-08-18T10:00:00.000Z" })],
          },
        ],
        NOW
      )
    ).toEqual([]);
  });
});

describe("presentation helpers", () => {
  it("falls back from the teacher's title to the video's, then to a generic", () => {
    expect(quizHeading({ title: "שלי", videoTitle: "סרטון" })).toBe("שלי");
    expect(quizHeading({ title: null, videoTitle: "סרטון" })).toBe("סרטון");
    expect(quizHeading({ title: null, videoTitle: null })).toBe("חידון");
  });

  it("formats a closing date in school-local time, not UTC", () => {
    // 22:30 UTC is already the next day in Jerusalem.
    expect(formatShortDate("2026-08-25T22:30:00.000Z")).toBe("26.8");
  });

  it("greets by the school's clock", () => {
    // 06:00 in Jerusalem.
    expect(greetingFor(new Date("2026-08-20T03:00:00.000Z"))).toBe("בוקר טוב");
    // 15:00 in Jerusalem.
    expect(greetingFor(new Date("2026-08-20T12:00:00.000Z"))).toBe("צהריים טובים");
    // 20:00 in Jerusalem.
    expect(greetingFor(new Date("2026-08-20T17:00:00.000Z"))).toBe("ערב טוב");
    // 01:00 in Jerusalem — every Hebrew night greeting is a farewell.
    expect(greetingFor(new Date("2026-08-19T22:00:00.000Z"))).toBe("שלום");
  });

  it("greets by first name only, and drops an empty one", () => {
    expect(firstName("דנה כהן לוי")).toBe("דנה");
    expect(firstName("   ")).toBeNull();
    expect(firstName(null)).toBeNull();
  });
});

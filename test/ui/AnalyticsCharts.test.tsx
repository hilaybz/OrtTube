/**
 * The analytics chart panels, rendered.
 *
 * Charts are the part of this section most likely to break on real data rather
 * than on types: a class with no completions, a student with one finished quiz, a
 * quiz assigned nowhere. Every one of those is an empty axis, an empty
 * `Math.max`, or a `null` score, and each would throw or draw nonsense rather
 * than fail to compile. So these tests render each panel twice — with data and
 * with nothing — and check that the empty case says so in words instead of
 * showing an axis with no marks.
 *
 * They also pin the two accessibility affordances the charts lean on, since a
 * chart that encodes a value only as a bar length gates it behind eyesight: the
 * table twin behind the toggle, and a legend whenever two series share a plot.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClassCharts } from "@/components/teacher/analytics/ClassCharts";
import { StudentCharts } from "@/components/teacher/analytics/StudentCharts";
import { QuizCharts } from "@/components/teacher/analytics/QuizCharts";
import type {
  ClassAnalyticsOverview,
  QuizAnalyticsOverview,
  ScoreBucket,
  StudentAnalytics,
} from "@/lib/analytics";

/**
 * jsdom ships no `ResizeObserver`, which the carousel uses to keep its arrow
 * buttons' disabled state honest. Stubbed rather than guarded in the component:
 * the API exists in every browser the app runs in, so a production guard would
 * be dead code written for the test environment.
 */
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      value: ResizeObserverStub,
      writable: true,
    });
  }
});

const CLASS_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const QUIZ_ID = "11111111-1111-1111-1111-111111111111";

function bands(counts: number[]): ScoreBucket[] {
  return counts.map((count, i) => ({
    bucket_min: i * 0.2,
    bucket_max: (i + 1) * 0.2,
    count,
  }));
}

function classOverview(
  overrides: Partial<ClassAnalyticsOverview> = {}
): ClassAnalyticsOverview {
  return {
    class_id: CLASS_ID,
    name: "Alpha",
    language: "he",
    member_count: 3,
    quiz_count: 2,
    students_completed: 2,
    average_score: 0.75,
    tutor_question_count: 4,
    score_distribution: bands([0, 0, 1, 0, 1]),
    completions: [
      { day: "2026-08-10", count: 1 },
      { day: "2026-08-12", count: 2 },
    ],
    quizzes: [
      {
        quiz_id: QUIZ_ID,
        title: "Photosynthesis",
        content_updated_at: null,
        excluded_attempt_count: 0,
        base_language: "he",
        question_count: 5,
        tutor_mode: "hints",
        max_attempts: null,
        published: true,
        available_from: null,
        available_until: null,
        assigned_at: "2026-08-01T00:00:00Z",
        member_count: 3,
        members_completed: 2,
        students_completed: 2,
        average_score: 0.75,
        tutor_question_count: 4,
      },
    ],
    ...overrides,
  };
}

function studentAnalytics(
  overrides: Partial<StudentAnalytics> = {}
): StudentAnalytics {
  return {
    student_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    display_name: "Alice",
    email: "alice@example.com",
    preferred_language: null,
    joined_at: "2026-07-01T00:00:00Z",
    summary: {
      class_count: 1,
      total_assigned: 2,
      quizzes_completed: 2,
      average_score: 0.8,
      peer_average_score: 0.6,
      tutor_question_count: 3,
    },
    classes: [
      {
        class_id: CLASS_ID,
        name: "Alpha",
        language: "he",
        member_count: 3,
        total_assigned: 2,
        quizzes_completed: 2,
        average_score: 0.8,
        class_average_score: 0.6,
      },
    ],
    quizzes: [
      {
        class_id: CLASS_ID,
        class_name: "Alpha",
        quiz_id: QUIZ_ID,
        title: "Photosynthesis",
        question_count: 5,
        published: true,
        available_from: null,
        available_until: null,
        assigned_at: "2026-08-01T00:00:00Z",
        max_attempts: null,
        attempt_count: 2,
        completed: true,
        last_completed_at: "2026-08-10T00:00:00Z",
        latest_score: 1,
        best_score: 1,
        class_average_score: 0.6,
        class_students_completed: 3,
        tutor_question_count: 3,
      },
      {
        class_id: CLASS_ID,
        class_name: "Alpha",
        quiz_id: "22222222-2222-2222-2222-222222222222",
        title: "Respiration",
        question_count: 4,
        published: true,
        available_from: null,
        available_until: null,
        assigned_at: "2026-08-05T00:00:00Z",
        max_attempts: null,
        attempt_count: 1,
        completed: true,
        last_completed_at: "2026-08-12T00:00:00Z",
        latest_score: 0.6,
        best_score: 0.6,
        class_average_score: 0.7,
        class_students_completed: 3,
        tutor_question_count: 0,
      },
    ],
    ...overrides,
  };
}

function quizOverview(
  overrides: Partial<QuizAnalyticsOverview> = {}
): QuizAnalyticsOverview {
  return {
    quiz_id: QUIZ_ID,
    title: "Photosynthesis",
    content_updated_at: null,
    excluded_attempt_count: 0,
    base_language: "he",
    visibility: "private",
    created_at: "2026-07-01T00:00:00Z",
    video: {
      video_id: "vvvvvvvv-vvvv-vvvv-vvvv-vvvvvvvvvvvv",
      youtube_video_id: "abc123",
      title: "Leaves",
      channel_name: "Bio",
      duration_seconds: 600,
    },
    summary: {
      question_count: 2,
      class_count: 1,
      member_count: 3,
      students_completed: 2,
      attempt_count: 3,
      completion_count: 3,
      average_score: 0.75,
      tutor_question_count: 2,
    },
    score_distribution: bands([0, 0, 1, 0, 1]),
    classes: [
      {
        class_id: CLASS_ID,
        name: "Alpha",
        language: "he",
        teacher_id: "tttttttt-tttt-tttt-tttt-tttttttttttt",
        teacher_name: "Ora",
        is_own_class: true,
        member_count: 3,
        published: true,
        available_from: null,
        available_until: null,
        assigned_at: "2026-08-01T00:00:00Z",
        max_attempts: null,
        tutor_mode: "hints",
        students_completed: 2,
        attempt_count: 3,
        average_score: 0.75,
        tutor_question_count: 2,
      },
    ],
    questions: [
      {
        question_id: "q1",
        order_index: 0,
        position_seconds: 10,
        kind: "single",
        deleted: false,
        prompt: "Q1",
        answered_count: 2,
        correct_count: 2,
        correct_pct: 1,
        tutor_question_count: 1,
      },
      {
        question_id: "q2",
        order_index: 1,
        position_seconds: 95,
        kind: "single",
        deleted: false,
        prompt: "Q2",
        answered_count: 2,
        correct_count: 1,
        correct_pct: 0.5,
        tutor_question_count: 1,
      },
    ],
    ...overrides,
  };
}

/** The chart card whose heading matches, so assertions stay scoped to that card. */
function cardFor(title: string): HTMLElement {
  return screen
    .getByRole("heading", { name: title, level: 3 })
    .closest(".glass") as HTMLElement;
}

describe("ClassCharts", () => {
  it("draws a chart per question a teacher asks of a class", () => {
    render(<ClassCharts data={classOverview()} />);
    expect(screen.getByRole("img", { name: "ציון ממוצע לפי חידון" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "התפלגות הציונים בכיתה" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "שיעור השלמה לפי חידון" })
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "השלמות לפי יום" })).toBeInTheDocument();
  });

  it("gives the carousel arrow controls and a focusable track", () => {
    render(<ClassCharts data={classOverview()} />);
    expect(
      screen.getByRole("button", { name: "התרשימים הקודמים" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "התרשימים הבאים" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "תרשימי הכיתה" })).toBeInTheDocument();
    // The track is reachable by Tab, so the arrow keys can scroll it.
    expect(
      screen.getByRole("group", { name: "גלילה בין התרשימים" })
    ).toHaveAttribute("tabindex", "0");
  });

  it("offers every chart's numbers as a table", async () => {
    const user = userEvent.setup();
    render(<ClassCharts data={classOverview()} />);
    const card = cardFor("ציון ממוצע לפי חידון");
    await user.click(within(card).getByRole("button", { name: "הצגה כטבלה" }));
    const table = within(card).getByRole("table");
    expect(within(table).getByText("Photosynthesis")).toBeInTheDocument();
    expect(within(table).getByText("75")).toBeInTheDocument();
    expect(within(table).getByText("2/3")).toBeInTheDocument();
  });

  it("says a class with nothing finished has nothing to show", () => {
    render(
      <ClassCharts
        data={classOverview({
          average_score: null,
          students_completed: 0,
          score_distribution: bands([0, 0, 0, 0, 0]),
          completions: [],
          quizzes: [],
        })}
      />
    );
    expect(
      screen.getByText("עדיין אין תוצאות מוגמרות בחידונים של הכיתה.")
    ).toBeInTheDocument();
    expect(screen.getByText("עדיין אין תוצאות מוגמרות בכיתה.")).toBeInTheDocument();
    expect(screen.getByText("עדיין לא הוקצו חידונים.")).toBeInTheDocument();
    expect(screen.getByText("עדיין לא הושלמו חידונים בכיתה.")).toBeInTheDocument();
  });
});

describe("StudentCharts", () => {
  it("legends the student against the class on every shared plot", () => {
    render(<StudentCharts data={studentAnalytics()} />);
    const trend = cardFor("מגמת ציונים");
    expect(within(trend).getByText("התלמיד/ה")).toBeInTheDocument();
    expect(within(trend).getByText("ממוצע הכיתה")).toBeInTheDocument();
  });

  it("refuses to draw a trend through a single point", () => {
    const data = studentAnalytics();
    data.quizzes = [data.quizzes[0]];
    render(<StudentCharts data={data} />);
    expect(
      screen.getByText("צריך שני חידונים מוגמרים לפחות כדי להראות מגמה.")
    ).toBeInTheDocument();
  });

  it("handles a student with no classes at all", () => {
    render(
      <StudentCharts
        data={studentAnalytics({ classes: [], quizzes: [] })}
      />
    );
    expect(screen.getAllByText("התלמיד/ה אינו/ה רשום/ה לכיתה.").length).toBe(2);
    expect(screen.getByText("התלמיד/ה עדיין לא שאל/ה את OrtAI.")).toBeInTheDocument();
  });
});

describe("QuizCharts", () => {
  it("plots per-question difficulty and per-class results", () => {
    render(<QuizCharts data={quizOverview()} />);
    expect(
      screen.getByRole("img", { name: "אחוז מענה נכון לפי שאלה" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "ציון ממוצע לפי כיתה" })
    ).toBeInTheDocument();
  });

  it("shows a question's playhead anchor in its table twin", async () => {
    const user = userEvent.setup();
    render(<QuizCharts data={quizOverview()} />);
    const card = cardFor("אחוז מענה נכון לפי שאלה");
    await user.click(within(card).getByRole("button", { name: "הצגה כטבלה" }));
    const table = within(card).getByRole("table");
    expect(within(table).getByText("0:10")).toBeInTheDocument();
    expect(within(table).getByText("1:35")).toBeInTheDocument();
  });

  it("handles a quiz that is assigned nowhere and answered by nobody", () => {
    render(
      <QuizCharts
        data={quizOverview({
          classes: [],
          score_distribution: bands([0, 0, 0, 0, 0]),
          questions: quizOverview().questions.map((q) => ({
            ...q,
            answered_count: 0,
            correct_count: 0,
            correct_pct: null,
          })),
        })}
      />
    );
    expect(screen.getByText("עדיין אין תשובות לשאלות החידון.")).toBeInTheDocument();
    expect(screen.getByText("עדיין אין תוצאות מוגמרות בחידון.")).toBeInTheDocument();
    expect(screen.getAllByText("החידון עדיין לא הוקצה לכיתה.").length).toBe(2);
  });
});

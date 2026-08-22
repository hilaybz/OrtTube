/**
 * The scheduling-window hard cutoff (Epic 2A.2), driven by the real
 * `QuizPlayer`. Fake timers throughout, with the device clock deliberately
 * skewed from the server's — the whole point of the offset calculation is
 * that the cutoff fires at the SERVER's deadline instant, not whatever the
 * device clock reads, so a test that doesn't skew the clock wouldn't catch a
 * regression to "trust the device clock" (which would silently give a
 * student with a slow clock extra time).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { StudentAttemptState, StudentQuestion } from "@/lib/attempts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const stage = { seekTo: vi.fn(), play: vi.fn(), pause: vi.fn() };

vi.mock("@/components/video/VideoStage", () => ({
  VideoStage: ({ overlay, ref }: { overlay?: React.ReactNode; ref?: { current: unknown } }) => {
    if (ref) ref.current = stage;
    return <div>{overlay}</div>;
  },
}));

vi.mock("@/components/student/AskAI", () => ({
  AskAI: () => null,
  AskAITrigger: () => null,
}));

import { QuizPlayer } from "@/components/student/QuizPlayer";

const QUESTIONS: StudentQuestion[] = [
  {
    id: "q1",
    kind: "single",
    position_seconds: 30,
    order_index: 0,
    prompt: "שאלה",
    options: [
      { id: "q1-o1", order_index: 0, text: "אלף" },
      { id: "q1-o2", order_index: 1, text: "בית" },
    ],
  },
];

const BASE_STATE: StudentAttemptState = {
  class_id: "class-1",
  quiz_id: "quiz-1",
  youtube_video_id: "vid00000001",
  video_title: "שיעור",
  duration_seconds: 600,
  base_language: "he",
  tutor_mode: "off",
  max_attempts: null,
  available_until: null,
  server_now: "2026-01-01T12:00:00.000Z",
  attempt_count: 0,
  completed_count: 0,
  attempts_left: null,
  in_progress: false,
  resume_attempt_id: null,
  last_completed_attempt_id: null,
  last_num_correct: null,
  last_num_questions: null,
};

let completeCalls: number;

function serveQuiz(): void {
  completeCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => {
        if (url.startsWith("/api/attempts/quiz")) {
          return {
            quiz: {
              quiz_id: "quiz-1",
              class_id: "class-1",
              title: null,
              base_language: "he",
              resolved_language: "he",
              served_complete: true,
              questions: QUESTIONS,
            },
          };
        }
        if (url.endsWith("/complete")) {
          completeCalls += 1;
          return { summary: { attempt_id: "attempt-1", attempt_no: 1, completed_at: new Date().toISOString(), num_questions: 1, num_correct: 0 } };
        }
        if (url.endsWith("/answers")) {
          return { answer: { question_id: "q" } };
        }
        return {
          attempt: {
            attempt_id: "attempt-1",
            attempt_no: 1,
            resumed: false,
            started_at: new Date().toISOString(),
            answered_question_ids: [],
          },
        };
      },
    }))
  );
}

async function startQuiz(state: StudentAttemptState): Promise<void> {
  serveQuiz();
  const user = userEvent.setup({ delay: null });
  render(<QuizPlayer classId="class-1" quizId="quiz-1" state={state} />);
  await user.click(screen.getByRole("button", { name: "התחלה" }));
  // The mock VideoStage never advances the playhead, so the checkpoint gate
  // overlay never opens (matches real behavior — nothing is due at 0:00 for a
  // question at 0:30) — the checkpoint stepper is what confirms "playing".
  await waitFor(() =>
    expect(screen.getByRole("list", { name: "נקודות העצירה בחידון" })).toBeInTheDocument()
  );
}

beforeEach(() => {
  // `shouldAdvanceTime` lets fake time tick forward in real-time increments,
  // so testing-library's real-time-based `waitFor`/`userEvent` polling still
  // makes progress; `vi.advanceTimersByTimeAsync` is still used below to jump
  // straight to the deadline instead of waiting five real minutes.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("QuizPlayer — scheduling-window cutoff", () => {
  it("fires at the server's deadline, compensating for a skewed device clock", async () => {
    // Device clock reads 12:00; the server was actually at 12:05 when the page
    // loaded (client is 5 minutes slow). The window closes at server time
    // 12:10 — five minutes of TRUE time from now, ten minutes of device time.
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    const state: StudentAttemptState = {
      ...BASE_STATE,
      server_now: "2026-01-01T12:05:00.000Z",
      available_until: "2026-01-01T12:10:00.000Z",
    };
    await startQuiz(state);

    // Just short of the true five-minute mark: nothing has happened yet.
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 59_000);
    expect(stage.pause).not.toHaveBeenCalled();
    expect(completeCalls).toBe(0);

    // Cross the true deadline (five minutes of elapsed time, not the device
    // clock's ten). A naive "trust the device clock" implementation would
    // still be waiting another five minutes here.
    await vi.advanceTimersByTimeAsync(2_000);

    await waitFor(() => expect(stage.pause).toHaveBeenCalled());
    await waitFor(() => expect(completeCalls).toBe(1));
    // The "done" screen shows timed-out copy, not the ordinary
    // "you finished the quiz" heading — a student mid-cutoff should
    // understand what happened rather than wonder why the video just ended.
    await waitFor(() =>
      expect(screen.getByText("הזמן למבחן הסתיים")).toBeInTheDocument()
    );
    expect(screen.queryByText("סיימת את החידון!")).not.toBeInTheDocument();
    // The checkpoint stepper (the "playing" phase) is gone — no further
    // interaction with the quiz is offered.
    expect(
      screen.queryByRole("list", { name: "נקודות העצירה בחידון" })
    ).not.toBeInTheDocument();
  });

  it("shows the time left before the student commits to starting", async () => {
    // Device clock reads 12:00 while the server was at 12:05 — the countdown
    // must report the true half hour left, not the device's 35 minutes.
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    render(
      <QuizPlayer
        classId="class-1"
        quizId="quiz-1"
        state={{
          ...BASE_STATE,
          server_now: "2026-01-01T12:05:00.000Z",
          available_until: "2026-01-01T12:35:00.000Z",
        }}
      />
    );

    expect(await screen.findByText("30:00")).toBeInTheDocument();
    expect(screen.queryByText("35:00")).not.toBeInTheDocument();
  });

  it("says plainly that a quiz has no deadline instead of leaving the slot empty", () => {
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    render(<QuizPlayer classId="class-1" quizId="quiz-1" state={BASE_STATE} />);

    expect(screen.getByText("ללא מועד הגשה")).toBeInTheDocument();
  });

  it("never schedules a cutoff when the allocation has no window", async () => {
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    await startQuiz(BASE_STATE); // available_until: null

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // an hour of elapsed time
    expect(stage.pause).not.toHaveBeenCalled();
    expect(completeCalls).toBe(0);
    // Still on the "playing" phase — nothing forced it to "done".
    expect(
      screen.getByRole("list", { name: "נקודות העצירה בחידון" })
    ).toBeInTheDocument();
  });
});

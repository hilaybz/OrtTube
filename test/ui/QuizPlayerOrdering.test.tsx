/**
 * Checkpoints arrive in VIDEO order, whatever order the teacher wrote them in.
 *
 * The player takes the next checkpoint to be the first unanswered question in
 * list order and gates the video at its timestamp — so if the list is in
 * authoring order, a question written late but positioned early arrives with its
 * gate BEHIND the playhead, and `gateDecision` snaps the student backwards.
 *
 * The fixture is the reported reproduction: authored at 0:30, then 1:30, then
 * 0:30. `order_index` reflects that authoring order, so a player that sorts by it
 * fails these tests and one that sorts by time passes.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StudentAttemptState, StudentQuestion } from "@/lib/attempts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Stands in for the YouTube embed: renders the overlay and lets a test move the
// playhead. React passes `ref` to a function component as a plain prop, so the
// imperative handle is published the way the real stage publishes it.
vi.mock("@/components/student/VideoStage", () => ({
  VideoStage: ({
    overlay,
    onProgress,
    ref,
  }: {
    overlay?: React.ReactNode;
    onProgress?: (current: number, duration: number) => void;
    ref?: { current: unknown };
  }) => {
    if (ref) ref.current = stage;
    return (
      <div>
        {[30, 90].map((s) => (
          <button key={s} type="button" onClick={() => onProgress?.(s, 600)}>
            {`advance-to-${s}`}
          </button>
        ))}
        {overlay}
      </div>
    );
  },
}));

vi.mock("@/components/student/AskAI", () => ({ AskAI: () => null }));

import { QuizPlayer } from "@/components/student/QuizPlayer";

const stage = { seekTo: vi.fn(), play: vi.fn(), pause: vi.fn() };

const STATE: StudentAttemptState = {
  class_id: "class-1",
  quiz_id: "quiz-1",
  youtube_video_id: "vid00000001",
  video_title: "שיעור",
  duration_seconds: 600,
  base_language: "he",
  tutor_mode: "off",
  max_attempts: null,
  attempt_count: 0,
  completed_count: 0,
  attempts_left: null,
  in_progress: false,
  resume_attempt_id: null,
  last_completed_attempt_id: null,
  last_num_correct: null,
  last_num_questions: null,
};

function q(id: string, positionSeconds: number, orderIndex: number): StudentQuestion {
  return {
    id,
    kind: "single",
    position_seconds: positionSeconds,
    order_index: orderIndex,
    prompt: id,
    options: [
      { id: `${id}-o1`, order_index: 0, text: "אלף" },
      { id: `${id}-o2`, order_index: 1, text: "בית" },
    ],
  };
}

// Authored 0:30 → 1:30 → 0:30, so `order_index` disagrees with the timeline.
const QUESTIONS: StudentQuestion[] = [
  q("first-at-0:30", 30, 0),
  q("at-1:30", 90, 1),
  q("second-at-0:30", 30, 2),
];

function serveQuiz(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.startsWith("/api/attempts/quiz")
          ? {
              quiz: {
                quiz_id: "quiz-1",
                class_id: "class-1",
                title: null,
                base_language: "he",
                resolved_language: "he",
                served_complete: true,
                questions: QUESTIONS,
              },
            }
          : url.endsWith("/answers")
            ? { answer: { question_id: "q" } }
            : {
                attempt: {
                  attempt_id: "attempt-1",
                  attempt_no: 1,
                  resumed: false,
                  started_at: new Date().toISOString(),
                  answered_question_ids: [],
                },
              },
    }))
  );
}

async function startQuiz(): Promise<void> {
  serveQuiz();
  render(<QuizPlayer classId="class-1" quizId="quiz-1" state={STATE} />);
  await userEvent.click(screen.getByRole("button", { name: "התחלה" }));
  await screen.findByRole("list", { name: "נקודות העצירה בחידון" });
}

async function answerCurrent(): Promise<void> {
  await userEvent.click(await screen.findByRole("radio", { name: /אלף/ }));
  await userEvent.click(screen.getByRole("button", { name: "שליחת תשובה" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QuizPlayer — checkpoint order", () => {
  it("asks both 0:30 questions before the 1:30 one", async () => {
    await startQuiz();

    await userEvent.click(screen.getByRole("button", { name: "advance-to-30" }));
    expect(await screen.findByText("first-at-0:30")).toBeInTheDocument();
    await answerCurrent();

    // Still at 0:30 — the second question authored there is due now, so it must
    // appear WITHOUT the playhead moving. Sorting by authoring order would jump
    // to the 1:30 question here and leave this one stranded until later.
    expect(await screen.findByText("second-at-0:30")).toBeInTheDocument();
    await answerCurrent();

    await userEvent.click(screen.getByRole("button", { name: "advance-to-90" }));
    expect(await screen.findByText("at-1:30")).toBeInTheDocument();
  });

  it("never gates on a checkpoint the student has already passed", async () => {
    await startQuiz();

    // Watch straight through to 1:30 and clear everything due by then.
    await userEvent.click(screen.getByRole("button", { name: "advance-to-30" }));
    await answerCurrent();
    await answerCurrent();
    await userEvent.click(screen.getByRole("button", { name: "advance-to-90" }));
    await answerCurrent();

    // With authoring order the third question (0:30) surfaced here, a minute
    // behind the playhead, and the gate clamped the video back to 0:30.
    expect(screen.queryByRole("radio", { name: /אלף/ })).not.toBeInTheDocument();
    expect(stage.seekTo).not.toHaveBeenCalled();
  });
});

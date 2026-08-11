/**
 * The checkpoint stepper is a progress display, not a navigation control. A
 * student must be able to see where the questions sit and which are behind them,
 * current, or still locked — but seeking is owned entirely by the block-skip
 * gate, so a marker must never move the playhead, and must not announce itself
 * as something that would.
 *
 * The one seek a student *may* trigger is the deliberate "rewatch this segment"
 * button in the question overlay, so that is pinned here too — removing marker
 * navigation must not take it with it.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StudentAttemptState, StudentQuestion } from "@/lib/attempts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// The real stage embeds the YouTube iframe player. The stub renders the overlay,
// lets a test move the playhead onto a checkpoint, and — since React passes `ref`
// to a function component as a plain prop — publishes the same imperative handle
// the real stage does, so seeks can be observed.
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
        {CHECKPOINTS.map((s) => (
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

const CHECKPOINTS = [60, 180];

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

const QUESTIONS: StudentQuestion[] = CHECKPOINTS.map((seconds, i) => ({
  id: `q${i + 1}`,
  kind: "single",
  position_seconds: seconds,
  order_index: i,
  prompt: `שאלה מספר ${i + 1}`,
  options: [
    { id: `q${i + 1}-o1`, order_index: 0, text: "אלף" },
    { id: `q${i + 1}-o2`, order_index: 1, text: "בית" },
  ],
}));

/** Serve the reads `start()` makes plus the answer POST, keyed by URL. */
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
            ? { answer: { question_id: "q1" } }
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

/** Reach a checkpoint, pick an answer and submit it, so that marker turns done. */
async function answerCheckpoint(seconds: number): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: `advance-to-${seconds}` }));
  await userEvent.click(await screen.findByRole("radio", { name: /אלף/ }));
  await userEvent.click(screen.getByRole("button", { name: "שליחת תשובה" }));
}

function markers(): HTMLElement[] {
  return screen.getAllByTestId("checkpoint-marker");
}

describe("QuizPlayer — checkpoint markers", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stage.seekTo.mockClear();
  });

  it("shows a marker per question with its state and timestamp", async () => {
    await startQuiz();

    const [first, second] = markers();
    expect(markers()).toHaveLength(2);
    expect(first).toHaveAttribute("data-state", "current");
    expect(first).toHaveTextContent("שאלה 1 · 1:00 · השאלה הנוכחית");
    expect(second).toHaveAttribute("data-state", "upcoming");
    expect(second).toHaveTextContent("שאלה 2 · 3:00 · טרם נפתחה");
    expect(screen.getByText("השאלה הבאה · 1:00")).toBeInTheDocument();
  });

  it("marks an answered checkpoint done and advances the current one", async () => {
    await startQuiz();
    await answerCheckpoint(60);

    await vi.waitFor(() =>
      expect(markers()[0]).toHaveAttribute("data-state", "done")
    );
    expect(markers()[0]).toHaveTextContent("שאלה 1 · 1:00 · נענתה");
    // The ✓ replaces the number, and is decorative — the state is in the label.
    expect(markers()[0].querySelector("[aria-hidden]")).toHaveTextContent("✓");
    expect(markers()[1]).toHaveAttribute("data-state", "current");
    expect(screen.getByText("השאלה הבאה · 3:00")).toBeInTheDocument();
  });

  it("renders markers as non-interactive status nodes, not navigation", async () => {
    await startQuiz();
    await answerCheckpoint(60);
    await vi.waitFor(() =>
      expect(markers()[0]).toHaveAttribute("data-state", "done")
    );

    for (const marker of markers()) {
      expect(marker.tagName).not.toBe("BUTTON");
      expect(marker).not.toHaveAttribute("title");
      expect(marker.className).not.toContain("cursor-");
      // Nothing about a marker may claim it navigates.
      expect(marker.textContent).not.toContain("מעבר");
    }
  });

  it("does not seek when a marker is clicked", async () => {
    await startQuiz();
    await answerCheckpoint(60);
    await vi.waitFor(() =>
      expect(markers()[0]).toHaveAttribute("data-state", "done")
    );
    stage.seekTo.mockClear();

    // Done, current and upcoming markers alike: clicking must be inert.
    for (const marker of markers()) await userEvent.click(marker);

    expect(stage.seekTo).not.toHaveBeenCalled();
  });

  it("still lets the question overlay rewatch the preceding segment", async () => {
    await startQuiz();
    await answerCheckpoint(60);
    await userEvent.click(screen.getByRole("button", { name: "advance-to-180" }));
    stage.seekTo.mockClear();

    await userEvent.click(
      await screen.findByRole("button", { name: /צפייה חוזרת בקטע/ })
    );

    // Back to the previous checkpoint — the segment this question is about.
    expect(stage.seekTo).toHaveBeenCalledWith(60);
  });
});

/**
 * The student must be able to tell a single-answer question from a multi-answer
 * one BEFORE answering. Grading is exact-set-match, so picking one option on a
 * multi-answer question loses the mark outright — a distinction the UI used to
 * leave the student to infer, since both rendered identical square controls.
 *
 * This pins the distinction at the level a student actually perceives it: the
 * shape of the control, the instruction text, and the ARIA role. It is the kind
 * of regression that is invisible in a diff, hence a test rather than a comment.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StudentAttemptState, StudentQuestion } from "@/lib/attempts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// The real stage embeds the YouTube iframe player. Replace it with a stub that
// renders the overlay and lets a test move the playhead onto the checkpoint.
vi.mock("@/components/student/VideoStage", () => ({
  VideoStage: ({
    overlay,
    onProgress,
  }: {
    overlay?: React.ReactNode;
    onProgress?: (current: number, duration: number) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onProgress?.(CHECKPOINT, 600)}>
        advance-to-checkpoint
      </button>
      {overlay}
    </div>
  ),
}));

vi.mock("@/components/student/AskAI", () => ({ AskAI: () => null }));

import { QuizPlayer } from "@/components/student/QuizPlayer";

const CHECKPOINT = 120;

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

function question(kind: "single" | "multi"): StudentQuestion {
  return {
    id: "q1",
    kind,
    position_seconds: CHECKPOINT,
    order_index: 0,
    prompt: "מה נכון?",
    options: [
      { id: "o1", order_index: 0, text: "אלף" },
      { id: "o2", order_index: 1, text: "בית" },
      { id: "o3", order_index: 2, text: "גימל" },
    ],
  };
}

/** Serve the two reads `start()` makes, keyed by URL. */
function serveQuiz(kind: "single" | "multi"): void {
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
                questions: [question(kind)],
              },
            }
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

/** Start the quiz and run the video up to the checkpoint so the question shows. */
async function playToCheckpoint(kind: "single" | "multi"): Promise<void> {
  serveQuiz(kind);
  render(<QuizPlayer classId="class-1" quizId="quiz-1" state={STATE} />);
  await userEvent.click(screen.getByRole("button", { name: "התחלה" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "advance-to-checkpoint" })
  );
}

describe("QuizPlayer — single vs multi answer questions", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders round radio-style controls for a single-answer question", async () => {
    await playToCheckpoint("single");

    expect(await screen.findByText("בחרו תשובה אחת")).toBeInTheDocument();
    const controls = screen.getAllByTestId("option-radio");
    expect(controls).toHaveLength(3);
    for (const c of controls) expect(c.className).toContain("rounded-full");
    expect(screen.queryAllByTestId("option-checkbox")).toHaveLength(0);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("renders square checkbox-style controls for a multi-answer question", async () => {
    await playToCheckpoint("multi");

    expect(
      await screen.findByText("בחרו את כל התשובות הנכונות")
    ).toBeInTheDocument();
    const controls = screen.getAllByTestId("option-checkbox");
    expect(controls).toHaveLength(3);
    for (const c of controls) expect(c.className).toContain("rounded-md");
    expect(screen.queryAllByTestId("option-radio")).toHaveLength(0);
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("keeps single-answer selection exclusive", async () => {
    await playToCheckpoint("single");
    await screen.findByText("בחרו תשובה אחת");

    await userEvent.click(screen.getByRole("radio", { name: /אלף/ }));
    await userEvent.click(screen.getByRole("radio", { name: /בית/ }));

    // Picking a second answer replaces the first rather than adding to it.
    expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /בית/ })).toBeChecked();
  });

  it("accumulates selections on a multi-answer question", async () => {
    await playToCheckpoint("multi");
    await screen.findByText("בחרו את כל התשובות הנכונות");

    await userEvent.click(screen.getByRole("checkbox", { name: /אלף/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /בית/ }));

    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
  });
});

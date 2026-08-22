/**
 * The checkpoint timeline under the player. Two things it must get right:
 *
 * 1. Position. A checkpoint sits at `videoTime / duration` along the bar —
 *    a question at 0:53 of a 15-minute video belongs at the very start, not
 *    a fifth of the way in. The display this replaced spaced markers evenly by
 *    question order, which put that question mid-bar; the assertions here fail
 *    on any such order-derived layout.
 * 2. Read-only-ness. It is a progress display, not a navigation control:
 *    seeking is owned entirely by the block-skip gate, so a marker must never
 *    move the playhead, nor announce itself as something that would.
 *
 * The one seek a student *may* trigger is the deliberate "rewatch this segment"
 * button in the question overlay, so that is pinned here too.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StudentAttemptState, StudentQuestion } from "@/lib/attempts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// The real stage embeds the YouTube iframe player. The stub renders the overlay,
// lets a test move the playhead onto a checkpoint (reporting the duration the
// real player would), and — since React passes `ref` to a function component as
// a plain prop — publishes the same imperative handle the real stage does, so
// seeks can be observed.
vi.mock("@/components/video/VideoStage", () => ({
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
        {[...CHECKPOINTS, DURATION].map((s) => (
          <button key={s} type="button" onClick={() => onProgress?.(s, DURATION)}>
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

/** A 15-minute video with an early question and a late one. */
const DURATION = 900;
const CHECKPOINTS = [53, 800];

const stage = { seekTo: vi.fn(), play: vi.fn(), pause: vi.fn() };

const STATE: StudentAttemptState = {
  class_id: "class-1",
  quiz_id: "quiz-1",
  youtube_video_id: "vid00000001",
  video_title: "שיעור",
  duration_seconds: DURATION,
  base_language: "he",
  tutor_mode: "off",
  max_attempts: null,
  available_until: null,
  server_now: "2026-01-01T00:00:00.000Z",
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

/** The percentage a marker is positioned at along the track. */
function markerLeftPct(marker: HTMLElement): number {
  return Number.parseFloat((marker.parentElement as HTMLElement).style.left);
}

function progressWidthPct(): number {
  return Number.parseFloat(screen.getByTestId("timeline-progress").style.width);
}

describe("QuizPlayer — checkpoint timeline", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stage.seekTo.mockClear();
  });

  it("places each checkpoint at its share of the duration, not by question order", async () => {
    await startQuiz();

    const [first, second] = markers();
    // 53s and 800s of a 900s video — NOT 0% and 100%, which is what spacing
    // markers evenly by question order would produce for two questions.
    expect(markerLeftPct(first)).toBeCloseTo((53 / DURATION) * 100, 4);
    expect(markerLeftPct(second)).toBeCloseTo((800 / DURATION) * 100, 4);
    // The early question really does sit near the start of the bar.
    expect(markerLeftPct(first)).toBeLessThan(10);
  });

  it("shows a marker per question with its state and timestamp", async () => {
    await startQuiz();

    const [first, second] = markers();
    expect(markers()).toHaveLength(2);
    expect(first).toHaveAttribute("data-state", "current");
    expect(first).toHaveTextContent("שאלה 1 · 0:53 · השאלה הנוכחית");
    expect(second).toHaveAttribute("data-state", "upcoming");
    expect(second).toHaveTextContent("שאלה 2 · 13:20 · טרם נפתחה");
  });

  it("fills the bar to the playhead as the video plays", async () => {
    await startQuiz();
    expect(progressWidthPct()).toBe(0);

    await userEvent.click(screen.getByRole("button", { name: "advance-to-53" }));

    expect(progressWidthPct()).toBeCloseTo((53 / DURATION) * 100, 4);
  });

  it("marks an answered checkpoint done and advances the current one", async () => {
    await startQuiz();
    await answerCheckpoint(53);

    await vi.waitFor(() =>
      expect(markers()[0]).toHaveAttribute("data-state", "done")
    );
    expect(markers()[0]).toHaveTextContent("שאלה 1 · 0:53 · נענתה");
    expect(markers()[1]).toHaveAttribute("data-state", "current");
    // The progress counter above the video moves with it.
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "1 מתוך 2 שאלות"
    );
  });

  it("renders markers as non-interactive status nodes, not navigation", async () => {
    await startQuiz();
    await answerCheckpoint(53);
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

  it("does not seek when a marker or the track is clicked", async () => {
    await startQuiz();
    await answerCheckpoint(53);
    await vi.waitFor(() =>
      expect(markers()[0]).toHaveAttribute("data-state", "done")
    );
    stage.seekTo.mockClear();

    // Done, current and upcoming markers alike: clicking must be inert.
    for (const marker of markers()) await userEvent.click(marker);
    await userEvent.click(screen.getByTestId("timeline-track"));

    expect(stage.seekTo).not.toHaveBeenCalled();
  });

  it("does not tack a 'next question' caption under the timeline", async () => {
    await startQuiz();
    expect(screen.queryByText(/השאלה הבאה/)).not.toBeInTheDocument();
  });

  it("still lets the question overlay rewatch the preceding segment", async () => {
    await startQuiz();
    await answerCheckpoint(53);
    await userEvent.click(screen.getByRole("button", { name: "advance-to-800" }));
    stage.seekTo.mockClear();

    await userEvent.click(
      await screen.findByRole("button", { name: /צפייה חוזרת בקטע/ })
    );

    // Back to the previous checkpoint — the segment this question is about.
    expect(stage.seekTo).toHaveBeenCalledWith(53);
  });
});

/**
 * Narrow integration test for the checkpoint timeline wired into QuizEditor —
 * `CheckpointTimeline` already has full unit coverage (test/ui/CheckpointTimeline.test.tsx),
 * so this only proves the wiring: a marker click seeks the (mocked) player and
 * highlights/scrolls to the matching question card; a drag commits through the
 * existing question-upsert endpoint and refreshes; the "current time" prefill
 * button in QuestionModal reflects the player's real reported position.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthorQuiz } from "@/lib/quizAuthor";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

const stage = { seekTo: vi.fn(), play: vi.fn(), pause: vi.fn() };

// The real stage embeds the YouTube iframe. The stub publishes the same
// imperative handle (seekTo/play/pause) and exposes a button so a test can
// simulate the player reporting a position/duration tick.
vi.mock("@/components/video/VideoStage", () => ({
  VideoStage: ({
    onProgress,
    ref,
  }: {
    onProgress?: (current: number, duration: number) => void;
    ref?: { current: unknown };
  }) => {
    if (ref) ref.current = stage;
    return (
      <div>
        <button type="button" onClick={() => onProgress?.(0, 300)}>
          report-ready
        </button>
        <button type="button" onClick={() => onProgress?.(45, 300)}>
          report-45s
        </button>
      </div>
    );
  },
}));

import { QuizEditor } from "@/components/teacher/editor/QuizEditor";

const QUIZ: AuthorQuiz = {
  quiz_id: "quiz-1",
  title: "חידון בדיקה",
  base_language: "he",
  visibility: "private",
  transcript_status: "ready",
  video: {
    id: "video-1",
    youtube_video_id: "aircAruvnKk",
    title: "סרטון",
    duration_seconds: null,
    transcript_status: "ready",
  },
  translated_languages: [],
  questions: [
    {
      id: "q1",
      kind: "single",
      position_seconds: 30,
      order_index: 0,
      prompt: "שאלה ראשונה",
      explanation: null,
      options: [
        { id: "q1-o1", order_index: 0, text: "אלף", is_correct: true },
        { id: "q1-o2", order_index: 1, text: "בית", is_correct: false },
      ],
    },
    {
      id: "q2",
      kind: "single",
      position_seconds: 90,
      order_index: 1,
      prompt: "שאלה שנייה",
      explanation: null,
      options: [
        { id: "q2-o1", order_index: 0, text: "גימל", is_correct: true },
        { id: "q2-o2", order_index: 1, text: "דלת", is_correct: false },
      ],
    },
  ],
};

function renderEditor() {
  render(<QuizEditor initial={QUIZ} classes={[]} allocations={[]} />);
}

// A second fixture with two questions sharing a timestamp, for the
// whole-cluster-drag test — kept separate so the other tests' marker
// counts/positions stay simple and unambiguous.
const CLUSTERED_QUIZ: AuthorQuiz = {
  ...QUIZ,
  questions: [
    { ...QUIZ.questions[0], position_seconds: 30 },
    { ...QUIZ.questions[1], id: "q2", position_seconds: 30 },
  ],
};

function renderClusteredEditor() {
  render(<QuizEditor initial={CLUSTERED_QUIZ} classes={[]} allocations={[]} />);
}

describe("QuizEditor — checkpoint timeline wiring", () => {
  beforeEach(() => {
    refresh.mockClear();
    stage.seekTo.mockClear();
    vi.unstubAllGlobals();
    // jsdom implements neither of these.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it("clicking a marker seeks the player and highlights the matching question card", async () => {
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "report-ready" }));

    const markers = screen.getAllByTestId("timeline-marker");
    expect(markers).toHaveLength(2);
    await userEvent.click(markers[0]); // q1 at 30s

    expect(stage.seekTo).toHaveBeenCalledWith(30);
    const card = screen.getByText("שאלה ראשונה").closest("li");
    const glass = card?.firstElementChild as HTMLElement;
    expect(glass.className).toContain("ring-2");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("dragging a marker commits the new position through the existing question-upsert endpoint and refreshes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ questionId: "q1" }) }))
    );
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "report-ready" }));

    const [marker] = screen.getAllByTestId("timeline-marker");
    const track = screen.getByTestId("timeline-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 300,
    } as DOMRect);

    // Track is 300px wide over a 300s duration (1px == 1s). Drag 100px past
    // the 5px threshold, well clear of a plain click.
    fireEvent.pointerDown(marker, { clientX: 30, pointerId: 1 });
    fireEvent.pointerMove(marker, { clientX: 130, pointerId: 1 });
    fireEvent.pointerUp(marker, { clientX: 130, pointerId: 1 });

    // The save is async (await apiFetch then refresh()) — wait for it to settle.
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());

    expect(fetch).toHaveBeenCalledWith(
      "/api/quizzes/quiz-1/questions",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toMatchObject({
      questionId: "q1",
      kind: "single",
      orderIndex: 0,
      basePrompt: "שאלה ראשונה",
      positionSeconds: 130,
    });
  });

  it("surfaces an error and does not refresh when the drag-drop save fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: { code: "not_owner" } }),
      }))
    );
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "report-ready" }));

    const [marker] = screen.getAllByTestId("timeline-marker");
    const track = screen.getByTestId("timeline-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 300,
    } as DOMRect);

    fireEvent.pointerDown(marker, { clientX: 30, pointerId: 1 });
    fireEvent.pointerMove(marker, { clientX: 80, pointerId: 1 });
    fireEvent.pointerUp(marker, { clientX: 80, pointerId: 1 });

    await screen.findByRole("alert");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("the current-time prefill button reflects the player's reported position, and is absent before any tick", async () => {
    renderEditor();

    // No progress reported yet — opening the modal must not claim a fake 0:00.
    await userEvent.click(screen.getByRole("button", { name: "הוספת שאלה" }));
    expect(screen.queryByText(/מהזמן הנוכחי בנגן/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ביטול" }));

    await userEvent.click(screen.getByRole("button", { name: "report-45s" }));
    await userEvent.click(screen.getByRole("button", { name: "הוספת שאלה" }));

    const prefill = await screen.findByRole("button", { name: /מהזמן הנוכחי בנגן/ });
    expect(prefill).toHaveTextContent("0:45");
    await userEvent.click(prefill);
    expect(screen.getByLabelText("נקודת עצירה")).toHaveValue("0:45");
  });

  it("dragging a whole cluster saves every clustered question to the new position and refreshes once", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ questionId: "q" }) }))
    );
    renderClusteredEditor();
    await userEvent.click(screen.getByRole("button", { name: "report-ready" }));

    const stack = screen.getByTestId("timeline-cluster");
    const track = screen.getByTestId("timeline-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 300,
    } as DOMRect);

    fireEvent.pointerDown(stack, { clientX: 30, pointerId: 1 });
    fireEvent.pointerMove(stack, { clientX: 130, pointerId: 1 }); // -> 130s
    fireEvent.pointerUp(stack, { clientX: 130, pointerId: 1 });

    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url]) => url === "/api/quizzes/quiz-1/questions"
    );
    expect(calls).toHaveLength(2);
    const questionIds = calls.map(([, init]) => JSON.parse(init.body).questionId).sort();
    expect(questionIds).toEqual(["q1", "q2"]);
    for (const [, init] of calls) {
      expect(JSON.parse(init.body).positionSeconds).toBe(130);
    }
  });
});

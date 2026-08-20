/**
 * The school catalog's "preview before cloning" flow (backlog 1.3 / issue
 * #13): opening a shared quiz read-only, correct answers and explanations
 * included, with a clone action right there instead of committing blind.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SharedQuiz } from "@/lib/sharing";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

// The real stage embeds the YouTube iframe. The stub publishes the same
// imperative handle and exposes a button so a test can simulate the player
// reporting a position/duration tick — same stub QuizEditorTimeline.test.tsx uses.
const stage = { seekTo: vi.fn(), play: vi.fn(), pause: vi.fn() };
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
      <button type="button" onClick={() => onProgress?.(0, 300)}>
        report-ready
      </button>
    );
  },
}));

import { QuizLibrary } from "@/components/teacher/library/QuizLibrary";

const S1: SharedQuiz = {
  quiz_id: "s1",
  title: "חידון פיזיקה",
  base_language: "he",
  visibility: "shared",
  video_id: "v1",
  youtube_video_id: "yt1",
  video_title: "יסודות הפיזיקה",
  channel_name: "Khan Academy",
  transcript_status: "ready",
  question_count: 1,
  author_id: "author-1",
  author_name: "דנה כהן",
  is_own: false,
  created_at: "2026-01-01T00:00:00.000Z",
  time_restricted: false,
  duration_minutes: null,
  duration_seconds: null,
};

const PREVIEW_QUIZ = {
  quiz_id: "s1",
  title: "חידון פיזיקה",
  base_language: "he" as const,
  visibility: "shared" as const,
  transcript_status: "ready" as const,
  video: {
    id: "v1",
    youtube_video_id: "yt1",
    title: "יסודות הפיזיקה",
    channel_name: "Khan Academy",
    duration_seconds: null,
    transcript_status: "ready" as const,
  },
  author_name: "דנה כהן",
  translated_languages: [],
  questions: [
    {
      id: "q1",
      kind: "single" as const,
      position_seconds: 30,
      order_index: 0,
      prompt: "מה מהירות האור?",
      explanation: "כי כך נמדד בריק.",
      options: [
        { id: "o1", is_correct: true, order_index: 0, text: "300,000 קמ/ש" },
        { id: "o2", is_correct: false, order_index: 1, text: "100 קמ/ש" },
      ],
    },
  ],
};

function renderLibrary(opts?: { sharedQuizzes?: SharedQuiz[] }) {
  render(
    <QuizLibrary
      myQuizzes={[]}
      sharedQuizzes={opts?.sharedQuizzes ?? [S1]}
      allocationTags={{}}
      classes={[]}
    />
  );
}

async function openSchoolTabAndPreview() {
  await userEvent.click(screen.getByRole("tab", { name: "מאגר בית הספר" }));
  await userEvent.click(screen.getByRole("button", { name: "תצוגה מקדימה" }));
}

function stubFetch(opts: { previewOk?: boolean; cloneOk?: boolean } = {}) {
  const previewOk = opts.previewOk ?? true;
  const cloneOk = opts.cloneOk ?? true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/quizzes/s1/preview") {
        return previewOk
          ? { ok: true, json: async () => ({ quiz: PREVIEW_QUIZ }) }
          : { ok: false, json: async () => ({ error: { code: "not_authorized" } }) };
      }
      if (url === "/api/quizzes/share") {
        return cloneOk
          ? { ok: true, json: async () => ({ quizId: "new-quiz-id" }) }
          : { ok: false, json: async () => ({ error: { code: "not_authorized" } }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
}

describe("QuizLibrary — preview before cloning", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    stage.seekTo.mockClear();
    vi.unstubAllGlobals();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders the video thumbnail on the catalog card", async () => {
    renderLibrary();
    await userEvent.click(screen.getByRole("tab", { name: "מאגר בית הספר" }));
    const img = screen.getByAltText("") as HTMLImageElement;
    expect(img.src).toContain("i.ytimg.com/vi/yt1/mqdefault.jpg");
  });

  it("opens the preview, fetches, and renders the quiz's content including correct answers and explanations", async () => {
    stubFetch();
    renderLibrary();
    await openSchoolTabAndPreview();

    const dialog = await screen.findByRole("dialog");
    await screen.findByText("מה מהירות האור?");
    const inDialog = within(dialog);
    expect(inDialog.getByText("300,000 קמ/ש")).toBeInTheDocument();
    expect(inDialog.getByText("100 קמ/ש")).toBeInTheDocument();
    expect(inDialog.getByText(/כי כך נמדד בריק/)).toBeInTheDocument();
    expect(inDialog.getByText(/דנה כהן/)).toBeInTheDocument();
  });

  it("is read-only — no edit/delete buttons, and the marker isn't draggable", async () => {
    stubFetch();
    renderLibrary();
    await openSchoolTabAndPreview();

    const dialog = await screen.findByRole("dialog");
    await screen.findByText("מה מהירות האור?");
    const inDialog = within(dialog);
    expect(inDialog.queryByRole("button", { name: "עריכה" })).not.toBeInTheDocument();
    expect(inDialog.queryByRole("button", { name: "מחיקה" })).not.toBeInTheDocument();

    // Markers only render once the (stubbed) player reports a duration.
    await userEvent.click(screen.getByRole("button", { name: "report-ready" }));
    const [marker] = screen.getAllByTestId("timeline-marker");
    // A draggable marker's own aria-label carries the drag hint (see
    // CheckpointTimeline.tsx) — a future change that wires onMarkerMove/
    // onEdit/onDelete through this read-only surface should fail here.
    expect(marker.getAttribute("aria-label")).not.toContain("גררו כדי להזיז");
  });

  it("clicking a timeline marker seeks the player and highlights the matching question", async () => {
    stubFetch();
    renderLibrary();
    await openSchoolTabAndPreview();
    await screen.findByText("מה מהירות האור?");

    await userEvent.click(screen.getByRole("button", { name: "report-ready" }));
    const [marker] = screen.getAllByTestId("timeline-marker");
    await userEvent.click(marker);

    expect(stage.seekTo).toHaveBeenCalledWith(30);
    const card = screen.getByText("מה מהירות האור?").closest("li");
    const glass = card?.firstElementChild as HTMLElement;
    expect(glass.className).toContain("ring-2");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("cloning from inside the preview calls the clone endpoint and navigates to the editor", async () => {
    stubFetch();
    renderLibrary();
    await openSchoolTabAndPreview();
    await screen.findByText("מה מהירות האור?");

    const dialog = screen.getByRole("dialog");
    await userEvent.click(
      screen.getAllByRole("button", { name: "שכפול" }).find((b) => dialog.contains(b))!
    );

    expect(fetch).toHaveBeenCalledWith(
      "/api/quizzes/share",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ sourceQuizId: "s1" }) })
    );
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/quizzes/new-quiz-id/edit"));
  });

  it("shows an alert when the preview fetch fails", async () => {
    stubFetch({ previewOk: false });
    renderLibrary();
    await openSchoolTabAndPreview();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows an empty-questions message for a quiz with none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/quizzes/s1/preview") {
          return {
            ok: true,
            json: async () => ({ quiz: { ...PREVIEW_QUIZ, questions: [] } }),
          };
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );
    renderLibrary();
    await openSchoolTabAndPreview();

    expect(await screen.findByText("אין שאלות בחידון זה.")).toBeInTheDocument();
  });

  it("closing the modal does not navigate or clone", async () => {
    stubFetch();
    renderLibrary();
    await openSchoolTabAndPreview();
    await screen.findByText("מה מהירות האור?");

    await userEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

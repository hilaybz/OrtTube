/**
 * The editor's page structure, as the redesign fixed it:
 *
 * - the sections run title box → video → questions → הקצאות;
 * - the destructive action is a trash icon in the page header, not a text link
 *   buried in the settings box, and it still confirms before deleting;
 * - visibility is the choice itself (פרטי / משותף), with no "נראות" label;
 * - the question list pages, while the timeline above it keeps every marker —
 *   so picking a marker whose question sits on another page has to move the
 *   list there, or the click would appear to do nothing.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthorQuestion, AuthorQuiz } from "@/lib/quizAuthor";
import type { QuizAllocation } from "@/lib/allocations";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

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
      <button type="button" onClick={() => onProgress?.(0, 600)}>
        report-ready
      </button>
    );
  },
}));

import { QuizEditor } from "@/components/teacher/editor/QuizEditor";

function question(n: number): AuthorQuestion {
  return {
    id: `q${n}`,
    kind: "single",
    position_seconds: n * 30,
    order_index: n - 1,
    prompt: `שאלה ${n}`,
    explanation: null,
    source: "authored",
    options: [
      { id: `q${n}-o1`, order_index: 0, text: "אלף", is_correct: true },
      { id: `q${n}-o2`, order_index: 1, text: "בית", is_correct: false },
    ],
  };
}

function quiz(questionCount: number): AuthorQuiz {
  return {
    quiz_id: "quiz-1",
    title: "חידון בדיקה",
    base_language: "he",
    visibility: "private",
    transcript_status: "ready",
    time_restricted: false,
    duration_minutes: null,
    video: {
      id: "video-1",
      youtube_video_id: "aircAruvnKk",
      title: "סרטון",
      duration_seconds: null,
      transcript_status: "ready",
    },
    translated_languages: [],
    questions: Array.from({ length: questionCount }, (_, i) => question(i + 1)),
  };
}

function renderEditor(questionCount = 2) {
  render(<QuizEditor initial={quiz(questionCount)} classes={[]} allocations={[]} />);
}

function allocation(n: number, overrides: Partial<QuizAllocation> = {}): QuizAllocation {
  return {
    class_id: `c${n}`,
    class_name: `כיתה ${n}`,
    class_language: "he",
    tutor_mode: "hints",
    max_attempts: 2,
    published: true,
    available_from: null,
    available_until: null,
    assigned_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("QuizEditor — page structure", () => {
  beforeEach(() => {
    refresh.mockClear();
    push.mockClear();
    stage.seekTo.mockClear();
    vi.unstubAllGlobals();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it("orders the sections video → questions → הקצאות, after the title box", () => {
    renderEditor();
    const sections = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent ?? "");
    expect(sections).toEqual(["הסרטון", "שאלות (2)", "הקצאות"]);
    // The title box comes first, so the title input precedes the video section.
    const titleInput = screen.getByLabelText("כותרת החידון");
    const videoHeading = screen.getByRole("heading", { level: 2, name: "הסרטון" });
    expect(
      titleInput.compareDocumentPosition(videoHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("offers visibility as the choice itself, with no 'נראות' label on screen", () => {
    renderEditor();
    expect(screen.getByRole("radio", { name: "פרטי" })).toBeInTheDocument();
    expect(screen.queryByText(/^נראות/)).not.toBeInTheDocument();
  });

  it("deletes through a trash icon in the header, and only after confirming", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => null }))
    );
    renderEditor();

    await userEvent.click(screen.getByRole("button", { name: "מחיקת החידון" }));
    expect(fetch).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));
    expect(fetch).toHaveBeenCalledWith(
      "/api/quizzes/quiz-1",
      expect.objectContaining({ method: "DELETE" })
    );
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/quizzes"));
  });

  it("will not save an emptied title — the same required-title rule as the create form", async () => {
    vi.stubGlobal("fetch", vi.fn());
    renderEditor();

    await userEvent.clear(screen.getByLabelText("כותרת החידון"));
    expect(screen.getByText("יש להזין כותרת לחידון.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שמירה" })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("כותרת החידון"), "שם חדש");
    expect(screen.queryByText("יש להזין כותרת לחידון.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שמירה" })).toBeEnabled();
  });

  it("shows the video's length in the header once the player reports one", async () => {
    renderEditor();
    expect(screen.getByText(/אורך הסרטון ייקבע/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "report-ready" }));
    // Scoped to the header: the timeline under the player shows a duration too.
    // "אורך הסרטון", not "משך" — the quiz's own duration is a separate,
    // teacher-controlled fact with its own block below.
    const identity = screen.getByRole("heading", { level: 1 }).parentElement!;
    expect(identity).toHaveTextContent("אורך הסרטון 10:00");
  });

  it("pages the question list instead of growing it without bound", async () => {
    renderEditor(10);
    expect(screen.getByText("שאלה 1")).toBeInTheDocument();
    expect(screen.queryByText("שאלה 9")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "העמוד הבא" }));
    expect(screen.getByText("שאלה 9")).toBeInTheDocument();
    expect(screen.queryByText("שאלה 1")).not.toBeInTheDocument();
  });

  it("moves the list to the page holding the question a marker points at", async () => {
    renderEditor(10);
    await userEvent.click(screen.getByRole("button", { name: "report-ready" }));

    const markers = screen.getAllByTestId("timeline-marker");
    expect(markers).toHaveLength(10);
    // The 10th question is on page 2; the list has to follow the marker there.
    await userEvent.click(markers[9]);

    expect(stage.seekTo).toHaveBeenCalledWith(300);
    expect(screen.getByText(/מתוך 10/).textContent).toContain("9–10");
  });
});

describe("QuizEditor — הקצאות", () => {
  const CLASSES = [
    {
      id: "c9",
      teacher_id: "t",
      school_id: "s",
      name: "כיתה 9",
      language: "he" as const,
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];

  function renderWithAllocations(allocations: QuizAllocation[]) {
    render(<QuizEditor initial={quiz(1)} classes={CLASSES} allocations={allocations} />);
  }

  beforeEach(() => {
    refresh.mockClear();
    vi.unstubAllGlobals();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("turns the row actions into labelled icons", () => {
    renderWithAllocations([allocation(1)]);
    expect(screen.getByRole("button", { name: "הקצאה לכיתות" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הסתרה מתלמידים" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "עריכת ההקצאה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ביטול הקצאה" })).toBeInTheDocument();
  });

  it("offers to publish an unpublished row rather than to hide it", () => {
    renderWithAllocations([allocation(1, { published: false })]);
    expect(screen.getByRole("button", { name: "הצגה לתלמידים" })).toBeInTheDocument();
  });

  it("asks before unassigning, and only then calls the endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => null }))
    );
    renderWithAllocations([allocation(1)]);

    await userEvent.click(screen.getByRole("button", { name: "ביטול הקצאה" }));
    expect(fetch).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "ביטול הקצאה" })
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/classes/c1/quizzes/quiz-1",
      expect.objectContaining({ method: "DELETE" })
    );
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("pages the allocation list", async () => {
    renderWithAllocations([1, 2, 3, 4, 5, 6].map((n) => allocation(n)));
    expect(screen.getByText("כיתה 1")).toBeInTheDocument();
    expect(screen.queryByText("כיתה 6")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "העמוד הבא" }));
    expect(screen.getByText("כיתה 6")).toBeInTheDocument();
  });
});

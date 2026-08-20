/**
 * The quiz card is a stretched-link card: an absolutely-positioned <Link> covers
 * the whole card so clicking anywhere opens the editor. The delete control has
 * to sit above that link, which is easy to get wrong here — `.glass > *` in
 * globals.css pins every direct child of a glass card to `z-index: 2`, so a
 * z-index on the button alone is trapped in its wrapper's stacking context and
 * the link keeps swallowing the click.
 *
 * jsdom does not do layout or stacking, so this cannot assert paint order. What
 * it can assert is the arrangement that makes the fix work — and, behaviourally,
 * that pressing the trash icon opens the confirmation instead of navigating.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MyQuiz } from "@/lib/quiz";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

import { QuizLibrary } from "@/components/teacher/library/QuizLibrary";

const QUIZ: MyQuiz = {
  quiz_id: "quiz-1",
  title: "חידון בדיקה",
  base_language: "he",
  visibility: "private",
  video_id: "video-1",
  youtube_video_id: "aircAruvnKk",
  video_title: "But what is a neural network?",
  channel_name: "3Blue1Brown",
  transcript_status: "ready",
  question_count: 4,
  created_at: new Date().toISOString(),
  time_restricted: false,
  duration_minutes: null,
  duration_seconds: null,
};

function renderLibrary(quizzes: MyQuiz[] = [QUIZ]) {
  render(<QuizLibrary myQuizzes={quizzes} sharedQuizzes={[]} allocationTags={{}} />);
}

describe("QuizLibrary — delete", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.unstubAllGlobals();
  });

  it("opens the confirmation dialog rather than following the card link", async () => {
    renderLibrary();

    await userEvent.click(screen.getByRole("button", { name: "מחיקת החידון" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/למחוק את/)).toBeInTheDocument();
  });

  it("keeps the delete control clickable while its wrapper lets clicks through", () => {
    renderLibrary();
    const button = screen.getByRole("button", { name: "מחיקת החידון" });
    // The button is wrapped by its tooltip; the positioned wrapper is above that.
    const wrapper = button.parentElement!.parentElement!;

    // The wrapper is lifted above the stretched link and made click-through, so
    // only the button itself intercepts. Losing either half reintroduces the bug.
    expect(wrapper.className).toContain("pointer-events-none");
    expect(wrapper.className).toContain("z-20");
    expect(button.className).toContain("pointer-events-auto");
  });

  it("deletes the quiz and refreshes the server-rendered list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => null }))
    );
    renderLibrary();

    await userEvent.click(screen.getByRole("button", { name: "מחיקת החידון" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/quizzes/quiz-1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("surfaces a failure and leaves the quiz in place", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: { code: "not_owner" } }),
      }))
    );
    renderLibrary();

    await userEvent.click(screen.getByRole("button", { name: "מחיקת החידון" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));

    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("carries the source video's title on the card when the quiz has its own", () => {
    renderLibrary();
    // Secondary facts live in the hover panel over the thumbnail — present in
    // the DOM (and the a11y tree), revealed on hover/focus.
    expect(screen.getByText("But what is a neural network?")).toBeInTheDocument();
  });

  it("does not repeat the video title when it is already the heading", () => {
    renderLibrary([{ ...QUIZ, title: null }]);
    expect(
      screen.getAllByText("But what is a neural network?")
    ).toHaveLength(1);
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AssignedQuiz } from "@/lib/classes";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

import { AssignedQuizzesSection } from "@/components/teacher/classes/AssignedQuizzesSection";

function quiz(overrides: Partial<AssignedQuiz>): AssignedQuiz {
  return {
    quiz_id: "q1",
    title: "חידון בדיקה",
    base_language: "he",
    visibility: "private",
    video_id: "v1",
    youtube_video_id: "yt1",
    video_title: "סרטון",
    tutor_mode: "hints",
    max_attempts: 1,
    published: true,
    available_from: null,
    available_until: null,
    assigned_at: "2026-01-01T00:00:00.000Z",
    question_count: 3,
    author_id: "author-1",
    author_name: null,
    is_own: true,
    ...overrides,
  };
}

function renderSection(assigned: AssignedQuiz[]) {
  render(
    <AssignedQuizzesSection classId="c1" assigned={assigned} myQuizzes={[]} />
  );
}

describe("AssignedQuizzesSection — end/reopen", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.unstubAllGlobals();
  });

  it("a live, window-less row shows the no-end-date note and an End-quiz button that opens a confirm modal first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    );
    renderSection([quiz({ published: true, available_from: null, available_until: null })]);

    expect(screen.getByText(/ללא מועד סיום/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "סיום השאלון עכשיו" })
    );

    expect(screen.getByText(/לסיים את/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "סיום השאלון" }));

    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      "/api/classes/c1/quizzes/q1",
      expect.objectContaining({ method: "PATCH" })
    );
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.availableFrom).toBeNull();
    expect(Date.now() - new Date(body.availableUntil).getTime()).toBeLessThan(5000);
  });

  it("a done row shows Reopen, not Hide, and reopening PATCHes immediately with no modal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    );
    renderSection([
      quiz({
        published: true,
        available_from: null,
        available_until: "2020-01-01T00:00:00.000Z",
      }),
    ]);

    expect(
      screen.queryByRole("button", { name: "הסתרה מתלמידים" })
    ).not.toBeInTheDocument();
    const reopenButton = screen.getByRole("button", {
      name: "פתיחת השאלון מחדש לכיתה",
    });

    await userEvent.click(reopenButton);

    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      "/api/classes/c1/quizzes/q1",
      expect.objectContaining({ method: "PATCH" })
    );
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toEqual({ availableFrom: null, availableUntil: null });
  });

  it("a withdrawn row offers no analytics link", () => {
    renderSection([quiz({ published: false })]);
    expect(screen.queryByRole("link", { name: /אנליטיקה/ })).not.toBeInTheDocument();
  });

  it("a live row does offer analytics", () => {
    renderSection([quiz({ published: true })]);
    expect(screen.getByRole("link", { name: /אנליטיקה/ })).toBeInTheDocument();
  });

  it("a scheduled row has no End-quiz button (nothing has started yet)", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    renderSection([quiz({ published: true, available_from: future, available_until: null })]);
    expect(
      screen.queryByRole("button", { name: "סיום השאלון עכשיו" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הסתרה מתלמידים" })).toBeInTheDocument();
  });
});

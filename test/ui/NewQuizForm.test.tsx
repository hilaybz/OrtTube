/**
 * The create-a-quiz form. Two rules carry real weight here:
 *
 * - **A title is required.** `create_quiz_for_video` happily stores NULL, and
 *   that server contract is deliberately untouched — this is a form-level rule,
 *   so it has to be enforced (and surfaced) in the client, and nothing may be
 *   created while it fails.
 * - **The link box is LTR inside an RTL form.** Its content is a URL, so it is
 *   `dir="ltr"`; the pasted link is resolved to a video id as it is typed so a
 *   wrong paste is caught before a quiz, a video row and a transcript fetch
 *   exist.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

import { NewQuizForm } from "@/components/teacher/editor/NewQuizForm";

const WATCH_URL = "https://www.youtube.com/watch?v=aircAruvnKk";

function stubCreate(ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ok
        ? { ok: true, json: async () => ({ quiz: { quiz_id: "new-quiz", transcript_status: "pending" } }) }
        : { ok: false, json: async () => ({ error: { code: "invalid_request" } }) }
    )
  );
}

function urlInput() {
  return screen.getByLabelText("קישור לסרטון YouTube");
}

async function submit() {
  await userEvent.click(screen.getByRole("button", { name: "יצירת החידון" }));
}

describe("NewQuizForm", () => {
  beforeEach(() => {
    push.mockClear();
    vi.unstubAllGlobals();
  });

  it("renders the URL box left-to-right, so a link reads and edits naturally", () => {
    render(<NewQuizForm />);
    expect(urlInput()).toHaveAttribute("dir", "ltr");
  });

  it("shows no validation errors before the first submit attempt", () => {
    render(<NewQuizForm />);
    expect(screen.queryByText("יש להזין כותרת לחידון.")).not.toBeInTheDocument();
    expect(screen.queryByText("יש להדביק קישור לסרטון.")).not.toBeInTheDocument();
  });

  it("refuses to create anything without a title, and says so", async () => {
    stubCreate();
    render(<NewQuizForm />);
    await userEvent.type(urlInput(), WATCH_URL);
    await submit();

    expect(screen.getByText("יש להזין כותרת לחידון.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("clears the title error as soon as a title is typed", async () => {
    stubCreate();
    render(<NewQuizForm />);
    await submit();
    expect(screen.getByText("יש להזין כותרת לחידון.")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("כותרת החידון"), "מבוא");
    expect(screen.queryByText("יש להזין כותרת לחידון.")).not.toBeInTheDocument();
  });

  it("refuses a link it cannot recognise", async () => {
    stubCreate();
    render(<NewQuizForm />);
    await userEvent.type(urlInput(), "https://example.com/not-a-video");
    await userEvent.type(screen.getByLabelText("כותרת החידון"), "מבוא");
    await submit();

    expect(screen.getByText("הקישור אינו קישור YouTube מזוהה.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("echoes the recognised video back as its own thumbnail while typing", async () => {
    render(<NewQuizForm />);
    await userEvent.type(urlInput(), WATCH_URL);

    expect(screen.getByText("זיהינו את הסרטון")).toBeInTheDocument();
    const img = screen.getByAltText("") as HTMLImageElement;
    expect(img.src).toContain("i.ytimg.com/vi/aircAruvnKk/mqdefault.jpg");
  });

  it("creates the quiz from a pasted URL and opens its editor", async () => {
    stubCreate();
    render(<NewQuizForm />);
    await userEvent.type(urlInput(), WATCH_URL);
    await userEvent.type(screen.getByLabelText("כותרת החידון"), "  מבוא לרשתות  ");
    await submit();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/quizzes");
    // The URL is sent as-is: the server stays the authority on extracting it.
    expect(JSON.parse(init.body)).toEqual({
      youtubeUrl: WATCH_URL,
      baseLanguage: "he",
      title: "מבוא לרשתות",
    });
    await vi.waitFor(() =>
      expect(push).toHaveBeenCalledWith("/dashboard/quizzes/new-quiz/edit")
    );
  });

  it("sends a bare video id as an id, which the server cannot extract from a URL", async () => {
    stubCreate();
    render(<NewQuizForm />);
    await userEvent.type(urlInput(), "aircAruvnKk");
    await userEvent.type(screen.getByLabelText("כותרת החידון"), "מבוא");
    await submit();

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ youtubeId: "aircAruvnKk" });
  });

  it("carries the chosen source language", async () => {
    stubCreate();
    render(<NewQuizForm />);
    await userEvent.type(urlInput(), WATCH_URL);
    await userEvent.type(screen.getByLabelText("כותרת החידון"), "Intro");
    await userEvent.click(screen.getByRole("radio", { name: "אנגלית" }));
    await submit();

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ baseLanguage: "en" });
  });

  it("surfaces a server failure and stays on the form", async () => {
    stubCreate(false);
    render(<NewQuizForm />);
    await userEvent.type(urlInput(), WATCH_URL);
    await userEvent.type(screen.getByLabelText("כותרת החידון"), "מבוא");
    await submit();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

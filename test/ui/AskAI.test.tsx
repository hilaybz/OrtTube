import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { AskAI } from "@/components/student/AskAI";

const ctx = { positionSeconds: 42, attemptId: "a1", activeQuestionId: "q1" };

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      chunks.forEach((t) => c.enqueue(enc.encode(t)));
      c.close();
    },
  });
}

describe("AskAI", () => {
  it("is hidden when tutor mode is off", () => {
    render(<AskAI classId="c" quizId="q" tutorMode="off" context={ctx} />);
    expect(screen.queryByRole("button", { name: /שאל/ })).not.toBeInTheDocument();
  });

  it("streams the tutor answer into the dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, body: streamOf(["חשוב ", "לחזור ל-03:40"]) }))
    );
    render(<AskAI classId="c" quizId="q" tutorMode="hints" context={ctx} />);
    await userEvent.click(screen.getByRole("button", { name: /שאל/ }));
    await userEvent.type(
      screen.getByPlaceholderText(/מה תרצו לשאול/),
      "מה הרעיון המרכזי?"
    );
    await userEvent.click(screen.getByRole("button", { name: "שליחה" }));
    expect(await screen.findByText(/חשוב לחזור ל-03:40/)).toBeInTheDocument();
  });

  it("shows a Hebrew error when the tutor is off server-side", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        body: null,
        json: async () => ({ error: { code: "tutor_off" } }),
      }))
    );
    render(<AskAI classId="c" quizId="q" tutorMode="hints" context={ctx} />);
    await userEvent.click(screen.getByRole("button", { name: /שאל/ }));
    await userEvent.type(screen.getByPlaceholderText(/מה תרצו לשאול/), "שאלה");
    await userEvent.click(screen.getByRole("button", { name: "שליחה" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

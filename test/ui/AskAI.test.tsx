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

/** Open the drawer. Its trigger names the tutor, so match on that. */
async function open() {
  await userEvent.click(screen.getByRole("button", { name: /שאל/ }));
}

/** Type a question and press the send icon button. */
async function send(question: string) {
  await userEvent.type(screen.getByPlaceholderText(/מה תרצו לשאול/), question);
  await userEvent.click(screen.getByRole("button", { name: "שליחה" }));
}

describe("AskAI", () => {
  it("is hidden when tutor mode is off", () => {
    render(<AskAI classId="c" quizId="q" tutorMode="off" context={ctx} />);
    expect(screen.queryByRole("button", { name: /שאל/ })).not.toBeInTheDocument();
  });

  it("names the tutor OrtAI, not the teacher", async () => {
    render(<AskAI classId="c" quizId="q" tutorMode="hints" context={ctx} />);
    expect(screen.getByRole("button", { name: "שאל/י את OrtAI" })).toBeInTheDocument();
    await open();
    expect(screen.getByRole("dialog", { name: "OrtAI" })).toBeInTheDocument();
    expect(screen.queryByText(/את המורה/)).not.toBeInTheDocument();
  });

  it("streams the tutor answer into the dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, body: streamOf(["חשוב ", "לחזור ל-03:40"]) }))
    );
    render(<AskAI classId="c" quizId="q" tutorMode="hints" context={ctx} />);
    await open();
    await send("מה הרעיון המרכזי?");
    expect(await screen.findByText(/חשוב לחזור ל-03:40/)).toBeInTheDocument();
  });

  it("renders the answer's markdown rather than its asterisks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: streamOf(["זה **חשוב** מאוד\n\n- נקודה ", "ראשונה"]),
      }))
    );
    render(<AskAI classId="c" quizId="q" tutorMode="hints" context={ctx} />);
    await open();
    await send("מה הרעיון?");

    const bold = await screen.findByText("חשוב");
    expect(bold.tagName).toBe("STRONG");
    // The markers themselves are gone from the rendered answer.
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    // A list arrives as a real list, one item per line.
    expect(await screen.findByRole("listitem")).toHaveTextContent("נקודה ראשונה");
  });

  it("shows a typing bubble in the assistant slot until the first token lands", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, body })));
    render(<AskAI classId="c" quizId="q" tutorMode="hints" context={ctx} />);
    await open();
    await send("שאלה");

    // Nothing to show yet, so the wait happens where the answer will appear.
    const typing = await screen.findByRole("status", { name: /מקליד/ });
    expect(typing).toBeInTheDocument();

    controller!.enqueue(new TextEncoder().encode("תשובה"));
    controller!.close();

    expect(await screen.findByText("תשובה")).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(screen.queryByRole("status", { name: /מקליד/ })).not.toBeInTheDocument()
    );
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
    await open();
    await send("שאלה");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

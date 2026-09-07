import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { AskAI, AskAITrigger } from "@/components/student/AskAI";

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

function renderChat(
  tutorMode: "off" | "hints" | "full" = "hints",
  open = true
): { onClose: ReturnType<typeof vi.fn>; onToggle: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn();
  const onToggle = vi.fn();
  render(
    <>
      <AskAITrigger tutorMode={tutorMode} open={open} onClick={onToggle} />
      <AskAI
        classId="c"
        quizId="q"
        tutorMode={tutorMode}
        context={ctx}
        open={open}
        onClose={onClose}
      />
    </>
  );
  return { onClose, onToggle };
}

async function send(question: string) {
  await userEvent.type(screen.getByPlaceholderText(/מה תרצו לשאול/), question);
  await userEvent.click(screen.getByRole("button", { name: "שליחה" }));
}

describe("AskAI", () => {
  it("is hidden — trigger and panel both — when tutor mode is off", () => {
    renderChat("off");
    expect(screen.queryByRole("button", { name: /שאל/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "OrtAI" })).not.toBeInTheDocument();
  });

  it("names the tutor OrtAI, not the teacher", () => {
    renderChat();
    expect(screen.getByRole("button", { name: "שאל/י את OrtAI" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "OrtAI" })).toBeInTheDocument();
    expect(screen.queryByText(/את המורה/)).not.toBeInTheDocument();
  });

  it("hands the open/close decision to the page rather than keeping it", async () => {
    const { onToggle, onClose } = renderChat();
    await userEvent.click(screen.getByRole("button", { name: /שאל/ }));
    expect(onToggle).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the closed panel out of the tab order — off-screen is not hidden", () => {
    renderChat("hints", false);
    const panel = document.querySelector("aside");
    expect(panel).toHaveAttribute("inert");
  });

  it("streams the tutor answer into the panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, body: streamOf(["חשוב ", "לחזור ל-03:40"]) }))
    );
    renderChat();
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
    renderChat();
    await send("מה הרעיון?");

    const bold = await screen.findByText("חשוב");
    expect(bold.tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
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
    renderChat();
    await send("שאלה");

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
    renderChat();
    await send("שאלה");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

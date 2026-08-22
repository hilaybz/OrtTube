"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Alert } from "@/components/ui/Alert";
import { ApiError } from "@/lib/http";
import { messageForCode } from "@/lib/errors";
import { MarkdownText } from "./TutorMarkdown";

export interface AskContext {
  positionSeconds: number;
  attemptId: string | null;
  activeQuestionId: string | null;
}

interface Msg {
  role: "user" | "assistant";
  text: string;
}

/** The AI tutor's product name, everywhere the student sees it. */
const TUTOR_NAME = "OrtAI";

/** How often streamed text is committed to the transcript (~25fps). */
const FLUSH_MS = 40;

/**
 * "OrtAI is writing" — the assistant's own message slot while the first token
 * is still on its way, so the wait happens where the answer will appear rather
 * than on the send button.
 */
function TypingDots() {
  return (
    <span
      role="status"
      aria-label={`${TUTOR_NAME} מקליד`}
      className="flex items-center gap-1 py-1"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{ animationDelay: `${i * 160}ms` }}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand)] [animation-duration:1.05s]"
        />
      ))}
    </span>
  );
}

/**
 * The button that opens the tutor. Separate from the panel because the panel is
 * laid out by the quiz page (beside the video, not over it), while the trigger
 * belongs in the player's own header row — but the tutor's name, glyph and
 * "off" rule stay here, in one file, rather than being restated at the call
 * site.
 */
export function AskAITrigger({
  tutorMode,
  open,
  onClick,
}: {
  tutorMode: "off" | "hints" | "full";
  open: boolean;
  onClick: () => void;
}) {
  if (tutorMode === "off") return null;
  return (
    <Button variant="secondary" onClick={onClick} aria-expanded={open}>
      <Icon name="sparkle" size={16} className="text-[var(--fg-brand)]" />
      {`שאל/י את ${TUTOR_NAME}`}
    </Button>
  );
}

/**
 * The AI tutor's chat panel. Hidden entirely when tutor_mode is "off". Each turn
 * streams plain text from POST /api/ask, grounded in what's been watched so
 * far — it never sees the answer key. The answer is rendered through
 * `MarkdownText`, which turns the model's light Markdown into elements rather
 * than showing raw `**asterisks**` (and never into HTML).
 *
 * Two shapes, one element. From 1100px up (the width where two columns still
 * leave the video worth watching — `min-[1100px]:` here and in `QuizPlayer`'s
 * grid, which have to agree) the panel is a real column in the page's flow,
 * sticky beside a video that shrank to make room:
 * nothing overlaps, nothing is dimmed, and the student can watch and ask at the
 * same time — which is the entire point of a tutor grounded in the part of the
 * video they have seen. Narrower than that there is no room for two columns, so
 * it slides in as a sheet over the page from the physical left (the nav rail is
 * on the right in this RTL app) with a scrim behind it.
 *
 * `open` is owned by the caller for the same reason: the video column's width
 * depends on it, and a component cannot resize its sibling. The panel stays
 * mounted while closed so the conversation is still there when it reopens.
 */
export function AskAI({
  classId,
  quizId,
  tutorMode,
  context,
  open,
  onClose,
}: {
  classId: string;
  quizId: string;
  tutorMode: "off" | "hints" | "full";
  context: AskContext;
  open: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * Jump to the newest turn. Deliberately NOT run per streamed token: the
   * transcript's trailing sentinel owns `overflow-anchor`, so the browser keeps
   * the bottom pinned by itself as the answer grows — and leaves the view alone
   * when the student has scrolled up to re-read something. This only handles the
   * two moments a jump is genuinely wanted: opening the drawer and asking.
   */
  function scrollToLatest() {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      el?.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
    });
  }

  useEffect(() => {
    if (open) scrollToLatest();
  }, [open]);

  if (tutorMode === "off") return null;

  async function ask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = prompt.trim();
    if (!q || busy) return;
    const prior = messages; // completed turns so far → sent as context
    setError(null);
    setBusy(true);
    setPrompt("");
    setMessages((m) => [...m, { role: "user", text: q }, { role: "assistant", text: "" }]);
    scrollToLatest();

    // Streamed text waits here until the next flush tick.
    let pending = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    function flushPending() {
      if (flushTimer != null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (pending === "") return;
      const delta = pending;
      pending = "";
      setMessages((m) => {
        const last = m[m.length - 1];
        // The turn was abandoned (an error dropped the bubble) — drop the text
        // with it rather than appending it to whatever is now last.
        if (last?.role !== "assistant") return m;
        return [...m.slice(0, -1), { role: "assistant" as const, text: last.text + delta }];
      });
    }

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          classId,
          quizId,
          prompt: q,
          positionSeconds: Math.round(context.positionSeconds),
          attemptId: context.attemptId ?? undefined,
          activeQuestionId: context.activeQuestionId ?? undefined,
          history: prior.map((m) => ({ role: m.role, content: m.text })),
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new ApiError(body?.error?.code ?? "internal_error");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        // Paint on a steady cadence rather than once per network chunk: the
        // model's deltas arrive in bursts, and rendering every one of them
        // makes the answer jitter its way onto the screen.
        if (flushTimer == null) flushTimer = setTimeout(flushPending, FLUSH_MS);
      }
      flushPending();
    } catch (err) {
      setMessages((m) => m.slice(0, -1)); // drop the empty assistant bubble
      setError(err instanceof ApiError ? err.message : messageForCode("internal_error"));
    } finally {
      if (flushTimer != null) clearTimeout(flushTimer);
      setBusy(false);
    }
  }

  return (
    <>
      {/* Scrim: only ever behind the sheet. In the column layout the page is
          fully usable while the chat is open, so there is nothing to dim. */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/30 transition-opacity min-[1100px]:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        aria-label={TUTOR_NAME}
        // Closed, it keeps its conversation but must not be reachable by Tab or
        // announced — off-screen is not hidden.
        inert={!open}
        className={cn(
          "glass flex flex-col p-0",
          // Sheet: over the page, sliding in from the physical left.
          "fixed bottom-0 left-0 top-0 z-50 w-[min(420px,92vw)] rounded-none transition-transform duration-300",
          open ? "translate-x-0" : "-translate-x-full",
          // Column: in the flow beside the video, sized by the grid cell the
          // quiz page gives it, and never off-screen.
          "min-[1100px]:relative min-[1100px]:bottom-auto min-[1100px]:left-auto min-[1100px]:top-auto min-[1100px]:z-auto min-[1100px]:h-[min(80vh,42rem)] min-[1100px]:w-full min-[1100px]:translate-x-0 min-[1100px]:rounded-[var(--radius)] min-[1100px]:transition-none",
          !open && "min-[1100px]:hidden"
        )}
      >
        <header className="flex items-center justify-between border-b border-[var(--glass-border-subtle)] p-4">
          <span className="flex items-center gap-2 text-lg font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--brand-soft)] bg-[var(--brand-softer)]">
              <Icon name="sparkle" size={15} className="text-[var(--fg-brand)]" />
            </span>
            {TUTOR_NAME}
          </span>
          <IconButton
            name="close"
            label="סגירה"
            size="sm"
            tooltipPlacement="bottom"
            onClick={onClose}
          />
        </header>

        {/* `overflow-anchor` does the sticking: the sentinel below is the anchor
            while the student is at the bottom, so a growing answer scrolls
            itself into view; scrolled up, the messages opt out of anchoring so
            nothing yanks the view around mid-read. */}
        <div
          ref={scrollRef}
          className={cn(
            "flex flex-1 flex-col gap-3 overflow-y-auto p-4",
            // Scrolling works; the bar itself is hidden in all three engines —
            // a transcript with a track down its side reads as a widget, and
            // this one is a conversation.
            "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          )}
        >
          {messages.length === 0 && !error && (
            <p className="mt-6 text-center text-sm text-[var(--body-subtle)]">
              שאלו כל דבר על מה שראיתם עד עכשיו — אני כאן כדי להדריך, לא לתת תשובות.
            </p>
          )}
          {messages.map((m, i) => {
            const waiting = m.role === "assistant" && m.text === "" && busy;
            return (
              <div
                key={i}
                className={cn(
                  "max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed [overflow-anchor:none]",
                  m.role === "user"
                    ? "me-auto bg-[var(--brand-softer)] text-[var(--fg-brand-strong)]"
                    : "ms-auto border border-[var(--glass-border)] bg-white/60 text-[var(--heading)]"
                )}
              >
                {m.role === "assistant" ? (
                  waiting ? (
                    <TypingDots />
                  ) : (
                    <MarkdownText text={m.text} />
                  )
                ) : (
                  <p className="whitespace-pre-wrap">{m.text}</p>
                )}
              </div>
            );
          })}
          {error && (
            <div className="[overflow-anchor:none]">
              <Alert variant="danger">{error}</Alert>
            </div>
          )}
          <div aria-hidden="true" className="h-px flex-none [overflow-anchor:auto]" />
        </div>

        <div className="border-t border-[var(--glass-border-subtle)] p-4">
          <p className="mb-2 flex items-start gap-2 text-xs text-[var(--body-subtle)]">
            <Icon name="lock" size={13} className="mt-0.5 flex-none" />
            רואה רק את מה שצפיתם בו עד עכשיו · לעולם לא חושף תשובות
          </p>
          <form onSubmit={ask} className="flex items-end gap-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget.form as HTMLFormElement)?.requestSubmit();
                }
              }}
              maxLength={1000}
              rows={2}
              placeholder="מה תרצו לשאול על מה שראיתם עד עכשיו?"
              className="flex-1 resize-none rounded-[var(--radius-d)] border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2.5 text-sm outline-none"
            />
            <IconButton
              type="submit"
              name="send"
              label="שליחה"
              variant="brand"
              size="lg"
              busy={busy}
              disabled={!prompt.trim()}
            />
          </form>
        </div>
      </aside>
    </>
  );
}

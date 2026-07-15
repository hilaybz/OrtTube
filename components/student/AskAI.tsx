"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Alert } from "@/components/ui/Alert";
import { ApiError } from "@/lib/http";
import { messageForCode } from "@/lib/errors";

export interface AskContext {
  positionSeconds: number;
  attemptId: string | null;
  activeQuestionId: string | null;
}

interface Msg {
  role: "user" | "assistant";
  text: string;
}

/**
 * The AI tutor as a slide-in chat drawer (opens from the left; the nav lives on
 * the right in this RTL app). Hidden entirely when tutor_mode is "off". Each
 * turn streams plain text from POST /api/ask, grounded in what's been watched so
 * far — it never sees the answer key.
 */
export function AskAI({
  classId,
  quizId,
  tutorMode,
  context,
}: {
  classId: string;
  quizId: string;
  tutorMode: "off" | "hints" | "full";
  context: AskContext;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  if (tutorMode === "off") return null;

  async function ask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = prompt.trim();
    if (!q || busy) return;
    setError(null);
    setBusy(true);
    setPrompt("");
    setMessages((m) => [...m, { role: "user", text: q }, { role: "assistant", text: "" }]);
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
        const chunk = decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: "assistant",
            text: copy[copy.length - 1].text + chunk,
          };
          return copy;
        });
      }
    } catch (err) {
      setMessages((m) => m.slice(0, -1)); // drop the empty assistant bubble
      setError(err instanceof ApiError ? err.message : messageForCode("internal_error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Icon name="sparkle" size={16} className="text-[var(--fg-brand)]" />
        שאל/י את המורה
      </Button>

      {/* scrim */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/30 transition-opacity",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* drawer — slides in from the physical left */}
      <aside
        role="dialog"
        aria-label="המורה־AI"
        className={cn(
          "glass fixed inset-y-0 left-0 z-50 flex w-[min(420px,92vw)] flex-col rounded-none p-0 transition-transform duration-300",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <header className="flex items-center justify-between border-b border-[var(--glass-border-subtle)] p-4">
          <span className="flex items-center gap-2 text-lg font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--brand-soft)] bg-[var(--brand-softer)]">
              <Icon name="sparkle" size={15} className="text-[var(--fg-brand)]" />
            </span>
            המורה־AI
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="סגירה"
            className="rounded-[var(--radius-sm)] p-1.5 text-[var(--body)] hover:bg-[var(--neutral-quaternary)]"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {messages.length === 0 && !error && (
            <p className="mt-6 text-center text-sm text-[var(--body-subtle)]">
              שאלו כל דבר על מה שראיתם עד עכשיו — אני כאן כדי להדריך, לא לתת תשובות.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                m.role === "user"
                  ? "me-auto bg-[var(--brand-softer)] text-[var(--fg-brand-strong)]"
                  : "ms-auto border border-[var(--glass-border)] bg-white/60 text-[var(--heading)]"
              )}
            >
              {m.text}
              {m.role === "assistant" && m.text === "" && busy && (
                <span className="inline-block h-4 w-2 animate-pulse bg-[var(--brand)] align-[-2px]" />
              )}
            </div>
          ))}
          {error && <Alert variant="danger">{error}</Alert>}
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
              className="flex-1 resize-none rounded-[var(--radius-d)] border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2.5 text-sm outline-none focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
            />
            <Button type="submit" disabled={busy || !prompt.trim()}>
              שליחה
            </Button>
          </form>
        </div>
      </aside>
    </>
  );
}

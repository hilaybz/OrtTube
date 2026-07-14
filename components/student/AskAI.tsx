"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
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

/**
 * The AI tutor. Hidden entirely when the class tutor_mode is "off". Streams the
 * answer as plain text from POST /api/ask (bounded server-side by tutor_mode and
 * the transcript sliced to the current playhead — it never sees the answer key).
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
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (tutorMode === "off") return null;

  async function ask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = prompt.trim();
    if (!q || busy) return;
    setBusy(true);
    setAnswer("");
    setError(null);
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
        setAnswer((a) => a + decoder.decode(value, { stream: true }));
      }
    } catch (err) {
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

      <Modal open={open} title="המורה־AI" onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-4">
          {error && <Alert variant="danger">{error}</Alert>}

          {(answer || busy) && (
            <div className="rounded-[var(--radius-d)] border border-[var(--glass-border)] bg-white/50 p-4 text-sm leading-relaxed">
              {answer}
              {busy && (
                <span className="ms-0.5 inline-block h-4 w-2 animate-pulse bg-[var(--brand)] align-[-2px]" />
              )}
            </div>
          )}

          <form onSubmit={ask} className="flex flex-col gap-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="מה תרצו לשאול על מה שראיתם עד עכשיו?"
              className="resize-none rounded-[var(--radius-d)] border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 text-sm outline-none focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
            />
            <Button type="submit" disabled={busy || !prompt.trim()}>
              שליחה
            </Button>
          </form>

          <p className="flex items-start gap-2 rounded-[var(--radius-d)] border border-dashed border-[var(--glass-border)] p-3 text-xs text-[var(--body)]">
            <Icon name="lock" size={15} className="mt-0.5 flex-none" />
            המורה־AI רואה רק את מה שצפיתם בו עד עכשיו, ולעולם לא ייתן את התשובה — רק ידריך.
          </p>
        </div>
      </Modal>
    </>
  );
}

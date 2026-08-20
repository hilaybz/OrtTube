"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";

type Status = "idle" | "running" | "done" | "empty" | "error";

/**
 * "Analyse with AI" over the tutor questions in one scope.
 *
 * Teacher-triggered only — this spends a frontier-model call, so it never runs
 * on page load, and nothing is stored: each press reads the questions as they
 * stand now. The answer streams in, which is the difference between a teacher
 * watching a spinner for twenty seconds and reading while it writes.
 *
 * `/api/analytics/insights` answers in one of two shapes and this component
 * branches on the content type: `text/plain` is the streamed analysis,
 * `application/json` is the "nothing to analyse" case (no questions in scope, no
 * model call made). Anything else is the uniform error envelope.
 *
 * The model is asked for plain prose with `• ` bullet lines and no markdown, so
 * the render is a deliberate three-case walk over the text rather than
 * `dangerouslySetInnerHTML` over model output.
 */
export function TutorInsights({
  scope,
  hasQuestions,
}: {
  scope: { quizId: string } | { classId: string };
  /** Skips the model call entirely when the scope is known to be empty. */
  hasQuestions: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [text, setText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  async function analyse() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("running");
    setText("");
    setErrorMessage("");

    try {
      const res = await fetch("/api/analytics/insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          "quizId" in scope ? { quizId: scope.quizId } : { classId: scope.classId }
        ),
        signal: controller.signal,
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErrorMessage(body?.error?.message ?? "ניתוח השאלות נכשל.");
        setStatus("error");
        return;
      }
      if (contentType.includes("application/json")) {
        setStatus("empty");
        return;
      }
      if (!res.body) {
        setErrorMessage("לא התקבלה תשובה מהמודל.");
        setStatus("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setText(answer);
      }
      setStatus("done");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setErrorMessage("ניתוח השאלות נכשל. נסו שוב.");
      setStatus("error");
    }
  }

  const running = status === "running";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={analyse} disabled={running || !hasQuestions}>
          <Icon name="sparkle" size={16} />
          {status === "idle" ? "נתחו עם AI" : "ניתוח מחדש"}
        </Button>
        {!hasQuestions && (
          <span className="text-sm text-[var(--body-subtle)]">
            אין עדיין שאלות לניתוח.
          </span>
        )}
        {running && text === "" && (
          <span className="inline-flex items-center gap-1.5 text-sm text-[var(--body-subtle)]">
            <TypingDots />
            קורא את השאלות…
          </span>
        )}
        {running && (
          <IconButton
            name="close"
            label="עצירת הניתוח"
            onClick={() => {
              abortRef.current?.abort();
              setStatus(text ? "done" : "idle");
            }}
          />
        )}
      </div>

      {status === "error" && (
        <Alert variant="danger" title="לא ניתן לנתח את השאלות">
          {errorMessage}
        </Alert>
      )}

      {status === "empty" && (
        <GlassCard>
          <p className="text-sm text-[var(--body)]">
            לא נמצאו שאלות שנשאלו את OrtAI בהיקף הזה, ולכן אין מה לנתח.
          </p>
        </GlassCard>
      )}

      {text && (
        <GlassCard className="flex flex-col gap-2">
          <InsightText text={text} />
          {running && <TypingDots />}
          <p className="text-xs text-[var(--body-subtle)]">
            נכתב על ידי AI מתוך השאלות שהתלמידים שאלו. כדאי לאמת לפני שינוי בהוראה.
          </p>
        </GlassCard>
      )}
    </div>
  );
}

/**
 * Renders the model's plain-text answer: `• ` lines collect into a list, every
 * other non-empty line is a paragraph. No HTML from the model ever reaches the
 * DOM as markup.
 */
function InsightText({ text }: { text: string }) {
  const blocks: { kind: "p" | "ul"; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const isBullet = line.startsWith("•") || line.startsWith("-") || line.startsWith("*");
    const content = isBullet ? line.replace(/^[•\-*]\s*/, "") : line;
    if (!content) continue;
    const last = blocks[blocks.length - 1];
    if (isBullet && last?.kind === "ul") {
      last.lines.push(content);
    } else if (isBullet) {
      blocks.push({ kind: "ul", lines: [content] });
    } else {
      blocks.push({ kind: "p", lines: [content] });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) =>
        block.kind === "ul" ? (
          <ul key={i} className="flex flex-col gap-1.5">
            {block.lines.map((line, j) => (
              <li key={j} className="flex gap-2 text-sm text-[var(--body)]">
                <Icon
                  name="chevronLeft"
                  size={16}
                  className="mt-0.5 flex-none text-[var(--fg-brand)]"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="text-sm text-[var(--heading)]">
            {block.lines[0]}
          </p>
        )
      )}
    </div>
  );
}

/** Three-dot "thinking" bubble, animated with the shared pulse utility. */
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand)]"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}

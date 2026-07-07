"use client";

import { useState } from "react";

interface Props {
  /** Background about the specific quiz question the student just answered, if any. */
  quizContext?: string;
  /** AI-generated timestamped outline of the whole video. */
  videoSummary?: string;
  /** Student's current position in the video, in seconds. */
  currentTimeSeconds?: number;
  onAsked?: (query: string, response: string) => void;
  /** Text for the collapsed trigger button. */
  triggerLabel?: string;
  /** Render the input open immediately, without a trigger button. */
  startOpen?: boolean;
}

export default function AskAI({
  quizContext,
  videoSummary,
  currentTimeSeconds,
  onAsked,
  triggerLabel = "עדיין לא ברור? שאלו את ה-AI",
  startOpen = false,
}: Props) {
  const [open, setOpen] = useState(startOpen);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAsk() {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setAnswer("");

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          quizContext,
          videoSummary,
          currentTimeSeconds,
        }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setAnswer(text);
      }

      if (text.trim()) onAsked?.(q, text);
    } catch {
      setAnswer("משהו השתבש. נסו שוב.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
      >
        <span>✦</span> {triggerLabel}
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          dir="auto"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAsk()}
          placeholder="שאלו כל דבר על השיעור…"
          className="flex-1 bg-[#1c1f26] border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          autoFocus
        />
        <button
          onClick={handleAsk}
          disabled={!question.trim() || loading}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
        >
          {loading ? "…" : "שאל"}
        </button>
      </div>

      {answer && (
        <div className="bg-[#0f1117] border border-gray-800 rounded-lg p-3">
          <p
            dir="auto"
            className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap"
          >
            {answer}
          </p>
        </div>
      )}
    </div>
  );
}

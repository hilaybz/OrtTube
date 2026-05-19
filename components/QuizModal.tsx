"use client";

import { useState } from "react";
import type { QuizCheckpoint } from "@/lib/demoQuiz";

interface Props {
  checkpoint: QuizCheckpoint;
  onComplete: () => void;
}

export default function QuizModal({ checkpoint, onComplete }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  const question = checkpoint.questions[currentIndex];
  const isLast = currentIndex === checkpoint.questions.length - 1;

  function handleSelect(index: number) {
    if (!submitted) setSelected(index);
  }

  function handleSubmit() {
    if (selected === null) return;
    if (selected === question.correct) setScore((s) => s + 1);
    setSubmitted(true);
  }

  function handleNext() {
    if (isLast) {
      setDone(true);
    } else {
      setCurrentIndex((i) => i + 1);
      setSelected(null);
      setSubmitted(false);
    }
  }

  const optionClass = (index: number) => {
    const base =
      "w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors cursor-pointer ";
    if (!submitted) {
      return (
        base +
        (selected === index
          ? "border-blue-500 bg-blue-500/10 text-white"
          : "border-gray-700 bg-[#1c1f26] text-gray-300 hover:border-gray-500 hover:bg-[#252830]")
      );
    }
    if (index === question.correct) return base + "border-green-500 bg-green-500/10 text-green-300";
    if (index === selected) return base + "border-red-500 bg-red-500/10 text-red-300";
    return base + "border-gray-700 bg-[#1c1f26] text-gray-500";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg bg-[#161920] border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">
              {checkpoint.label}
            </span>
            {!done && (
              <p className="text-gray-500 text-xs mt-0.5">
                Question {currentIndex + 1} of {checkpoint.questions.length}
              </p>
            )}
          </div>
          <div className="flex gap-1">
            {checkpoint.questions.map((_, i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full ${
                  i < currentIndex
                    ? "bg-blue-500"
                    : i === currentIndex
                    ? "bg-blue-400"
                    : "bg-gray-700"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {!done ? (
            <>
              <p className="text-white font-medium mb-5 leading-relaxed">{question.question}</p>
              <div className="space-y-2">
                {question.options.map((option, i) => (
                  <button key={i} className={optionClass(i)} onClick={() => handleSelect(i)}>
                    <span className="text-gray-500 mr-2 font-mono text-xs">
                      {String.fromCharCode(65 + i)}.
                    </span>
                    {option}
                  </button>
                ))}
              </div>

              {submitted && (
                <>
                  <div className="mt-4 p-3 bg-[#1c1f26] rounded-xl border border-gray-700">
                    <p className="text-xs text-gray-400 leading-relaxed">
                      <span className="text-yellow-400 font-semibold">Explanation: </span>
                      {question.explanation}
                    </p>
                  </div>
                  <AskAI
                    quizContext={`Question: ${question.question}\nCorrect answer: ${question.options[question.correct]}\nExplanation: ${question.explanation}`}
                    transcriptContext={checkpoint.transcriptContext}
                  />
                </>
              )}
            </>
          ) : (
            <div className="text-center py-4 space-y-3">
              <div className="text-4xl font-bold text-white">
                {score}/{checkpoint.questions.length}
              </div>
              <p className="text-gray-400">
                {score === checkpoint.questions.length
                  ? "Perfect score! Keep watching."
                  : score >= checkpoint.questions.length / 2
                  ? "Good work — back to the video."
                  : "Consider rewatching this section."}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex justify-end">
          {!done ? (
            submitted ? (
              <button
                onClick={handleNext}
                className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2 rounded-xl transition-colors"
              >
                {isLast ? "See results" : "Next question"}
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={selected === null}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-xl transition-colors"
              >
                Submit answer
              </button>
            )
          ) : (
            <button
              onClick={onComplete}
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2 rounded-xl transition-colors"
            >
              Continue watching →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Ask AI sub-component ──────────────────────────────────────────────────────

interface AskAIProps {
  quizContext: string;
  transcriptContext?: string;
}

function AskAI({ quizContext, transcriptContext }: AskAIProps) {
  const [open, setOpen] = useState(false);
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
        body: JSON.stringify({ question: q, quizContext, transcriptContext }),
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
    } catch {
      setAnswer("Something went wrong. Try again.");
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
        <span>✦</span> Still confused? Ask AI
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAsk()}
          placeholder="Ask anything about this…"
          className="flex-1 bg-[#1c1f26] border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 text-xs focus:outline-none focus:border-blue-500 transition-colors"
          autoFocus
        />
        <button
          onClick={handleAsk}
          disabled={!question.trim() || loading}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
        >
          {loading ? "…" : "Ask"}
        </button>
      </div>

      {answer && (
        <div className="bg-[#0f1117] border border-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{answer}</p>
        </div>
      )}
    </div>
  );
}

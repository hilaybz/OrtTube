"use client";

import { useState } from "react";
import AskAI from "@/components/AskAI";
import type { QuizCheckpoint } from "@/lib/demoQuiz";

interface Props {
  checkpoint: QuizCheckpoint;
  videoSummary?: string;
  currentTimeSeconds?: number;
  onComplete: () => void;
  onAnswer?: (questionIndex: number, selectedIndex: number, isCorrect: boolean) => void;
  onAskAi?: (query: string, response: string) => void;
}

export default function QuizModal({
  checkpoint,
  videoSummary,
  currentTimeSeconds,
  onComplete,
  onAnswer,
  onAskAi,
}: Props) {
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
    const isCorrect = selected === question.correct;
    if (isCorrect) setScore((s) => s + 1);
    setSubmitted(true);
    onAnswer?.(currentIndex, selected, isCorrect);
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
      "w-full text-start px-4 py-3 rounded-xl border text-sm transition-colors cursor-pointer ";
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

  const askContext =
    submitted && selected !== null
      ? [
          `Quiz question: ${question.question}`,
          `Student's answer: ${question.options[selected]} (${selected === question.correct ? "correct" : "incorrect"})`,
          `Correct answer: ${question.options[question.correct]}`,
          `Explanation: ${question.explanation}`,
        ].join("\n")
      : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4 py-6">
      <div className="w-full max-w-lg max-h-[85dvh] overflow-y-auto bg-[#161920] border border-gray-700 rounded-2xl shadow-2xl animate-modal-in">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <span
              dir="auto"
              className="text-xs font-semibold text-blue-400 uppercase tracking-wider"
            >
              {checkpoint.label}
            </span>
            {!done && (
              <p className="text-gray-500 text-xs mt-0.5">
                שאלה {currentIndex + 1} מתוך {checkpoint.questions.length}
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
              <p dir="auto" className="text-white font-medium mb-5 leading-relaxed">
                {question.question}
              </p>
              <div className="space-y-2">
                {question.options.map((option, i) => (
                  <button
                    key={i}
                    dir="auto"
                    className={optionClass(i)}
                    onClick={() => handleSelect(i)}
                  >
                    <span className="text-gray-500 me-2 font-mono text-xs">
                      {String.fromCharCode(65 + i)}.
                    </span>
                    {option}
                  </button>
                ))}
              </div>

              {submitted && (
                <>
                  <div className="mt-4 p-3 bg-[#1c1f26] rounded-xl border border-gray-700">
                    <p dir="auto" className="text-xs text-gray-400 leading-relaxed">
                      <span className="text-yellow-400 font-semibold">הסבר: </span>
                      {question.explanation}
                    </p>
                  </div>
                  <AskAI
                    quizContext={askContext}
                    videoSummary={videoSummary}
                    currentTimeSeconds={currentTimeSeconds}
                    onAsked={onAskAi}
                  />
                </>
              )}
            </>
          ) : (
            <div className="text-center py-4 space-y-3">
              <div
                className={`mx-auto w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold border-4 ${
                  score === checkpoint.questions.length
                    ? "border-green-500 text-green-400"
                    : score >= checkpoint.questions.length / 2
                    ? "border-blue-500 text-blue-400"
                    : "border-yellow-500 text-yellow-400"
                }`}
              >
                {score}/{checkpoint.questions.length}
              </div>
              <p className="text-gray-400">
                {score === checkpoint.questions.length
                  ? "מושלם! ממשיכים בצפייה."
                  : score >= checkpoint.questions.length / 2
                  ? "עבודה טובה — חוזרים לסרטון."
                  : "כדאי לצפות שוב בקטע הזה."}
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
                className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
              >
                {isLast ? "לתוצאות" : "השאלה הבאה"}
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={selected === null}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
              >
                שליחת תשובה
              </button>
            )
          ) : (
            <button
              onClick={onComplete}
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
            >
              ← ממשיכים לצפות
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

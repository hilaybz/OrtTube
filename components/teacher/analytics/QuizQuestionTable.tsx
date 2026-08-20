"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/Badge";
import { Pager } from "@/components/ui/Pager";
import { usePagedList } from "@/components/ui/usePagedList";
import type { QuizAnalyticsQuestion } from "@/lib/analytics";
import { pct } from "./chartTheme";
import { CELL, HEAD_CELL, ROW_BORDER, ROW_HEAD } from "./tableStyles";

/** "1:23" from a question's playhead anchor. */
function timestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The quiz's questions ranked by how often students get them WRONG — hardest
 * first. This is the author's edit list: the top of it is either a question worth
 * reteaching or a question worth rewriting.
 *
 * Never-answered questions sort last rather than first. A question with no
 * answers has a `null` correct-%, which is "unknown", not "zero" — ranking it as
 * the hardest question in the quiz would be a fabrication.
 *
 * Soft-deleted questions are kept and marked, not hidden: a since-removed
 * question's history still explains a class's past results.
 */
export function QuizQuestionTable({
  questions,
}: {
  questions: QuizAnalyticsQuestion[];
}) {
  const ranked = useMemo(
    () =>
      [...questions].sort((a, b) => {
        if (a.correct_pct == null && b.correct_pct == null) {
          return a.order_index - b.order_index;
        }
        if (a.correct_pct == null) return 1;
        if (b.correct_pct == null) return -1;
        return Number(a.correct_pct) - Number(b.correct_pct);
      }),
    [questions]
  );

  const paged = usePagedList(ranked, { pageSize: 10 });

  if (questions.length === 0) {
    return (
      <p className="glass p-5 text-sm text-[var(--body-subtle)]">
        אין שאלות בחידון זה.
      </p>
    );
  }

  return (
    <div className="glass">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-start">
          <caption className="sr-only">
            שאלות החידון לפי אחוז המענה הנכון, מהנמוך לגבוה
          </caption>
          <thead>
            <tr className={ROW_BORDER}>
              <th scope="col" className={HEAD_CELL}>
                שאלה
              </th>
              <th scope="col" className={HEAD_CELL}>
                מיקום בסרטון
              </th>
              <th scope="col" className={HEAD_CELL}>
                נכונות
              </th>
              <th scope="col" className={HEAD_CELL}>
                תשובות
              </th>
              <th scope="col" className={HEAD_CELL}>
                שאלות ל-OrtAI
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.slice.map((q, i) => (
              <tr
                key={q.question_id}
                className={`${i === paged.slice.length - 1 ? "" : ROW_BORDER} ${
                  q.deleted ? "opacity-60" : ""
                }`}
              >
                <th scope="row" className={ROW_HEAD}>
                  <span className="block max-w-[46ch] truncate">
                    {q.prompt ?? "שאלה"}
                  </span>
                  {q.deleted && (
                    <span className="mt-1 inline-block">
                      <Badge variant="gray">נמחקה</Badge>
                    </span>
                  )}
                </th>
                <td className={CELL}>{timestamp(q.position_seconds)}</td>
                <td className={CELL}>
                  <Badge
                    variant={
                      q.correct_pct == null
                        ? "gray"
                        : Number(q.correct_pct) < 0.5
                          ? "danger"
                          : Number(q.correct_pct) < 0.8
                            ? "warning"
                            : "success"
                    }
                  >
                    {pct(q.correct_pct)}
                  </Badge>
                </td>
                <td className={CELL}>{q.answered_count}</td>
                <td className={CELL}>{q.tutor_question_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 pb-3">
        <Pager {...paged} label="ניווט בין השאלות" />
      </div>
    </div>
  );
}

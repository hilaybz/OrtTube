"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/Select";
import {
  classQuizAnalyticsHref,
  quizAnalyticsHref,
} from "@/components/teacher/analyticsLinks";

/**
 * Narrows the quiz view to one class, and back out to every class again.
 *
 * The point of the control is that comparing classes costs one dropdown rather
 * than a trip back out to each class in turn, so "all classes" is an option
 * beside them rather than something the reader has to navigate to. It therefore
 * renders even for a single class: choosing between that class and the rollup
 * is still a choice.
 *
 * Only classes the reader teaches are offered — the list is built from their own
 * allocations — because the narrowed numbers come from an RPC gated on teaching
 * the class. A colleague's class running the same shared quiz appears in the
 * table below with its totals and no drill-down, and it must not appear here
 * either.
 *
 * Switching drops any `?from=` the page was opened with: that key names where
 * the reader entered from, and once they have moved between classes under their
 * own steam, back belongs at the quiz.
 */
export function QuizClassFilter({
  quizId,
  classId,
  classes,
}: {
  quizId: string;
  /** `null` while the view is showing every class. */
  classId: string | null;
  classes: { id: string; name: string }[];
}) {
  const router = useRouter();

  if (classes.length === 0) return null;

  return (
    <Select
      label="כיתה"
      name="analytics-class"
      value={classId ?? ""}
      className="min-w-44"
      onChange={(e) =>
        router.push(
          e.target.value
            ? classQuizAnalyticsHref(e.target.value, quizId)
            : quizAnalyticsHref(quizId)
        )
      }
    >
      <option value="">כל הכיתות</option>
      {classes.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}

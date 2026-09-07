"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/Select";
import {
  classQuizAnalyticsHref,
  quizAnalyticsHref,
} from "@/components/teacher/analyticsLinks";

/**
 * Only classes the reader teaches are offered — the list is built from their own
 * allocations — because the narrowed numbers come from an RPC gated on teaching
 * the class. A colleague's class running the same shared quiz appears in the
 * table below with its totals and no drill-down, and it must not appear here
 * either.
 */
export function QuizClassFilter({
  quizId,
  classId,
  classes,
}: {
  quizId: string;
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

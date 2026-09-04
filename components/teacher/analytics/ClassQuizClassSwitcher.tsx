"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/Select";
import { classQuizAnalyticsHref } from "@/components/teacher/analyticsLinks";

/**
 * Flips the per-(class, quiz) view between the classes running the same quiz,
 * without going back up to a class first.
 *
 * Only classes the reader teaches are offered — the list is built from their own
 * allocations — so every option leads somewhere they can actually open. A
 * teacher with a single class running this quiz has nothing to switch to, and
 * the control renders as nothing rather than as a dropdown with one entry.
 *
 * Switching drops any `?from=` the page was opened with: that key names where
 * the reader entered THIS class's numbers from, and once they are looking at a
 * different class, back belongs at that class's analytics instead.
 */
export function ClassQuizClassSwitcher({
  classId,
  quizId,
  classes,
}: {
  classId: string;
  quizId: string;
  classes: { id: string; name: string }[];
}) {
  const router = useRouter();

  if (classes.length < 2) return null;

  return (
    <Select
      label="כיתה"
      name="analytics-class"
      value={classId}
      className="min-w-44"
      onChange={(e) => router.push(classQuizAnalyticsHref(e.target.value, quizId))}
    >
      {classes.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}

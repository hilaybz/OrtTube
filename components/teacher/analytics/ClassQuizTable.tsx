"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Pager } from "@/components/ui/Pager";
import { usePagedList } from "@/components/ui/usePagedList";
import { allocationStatus } from "@/components/teacher/scheduleFormat";
import type { ClassOverviewQuiz } from "@/lib/analytics";
import { grade } from "./chartTheme";
import { CELL, HEAD_CELL, ROW_BORDER, ROW_HEAD, ROW_LINK } from "./tableStyles";

/**
 * The class's assigned quizzes, one row each, linking through to that quiz's
 * breakdown INSIDE this class (`/dashboard/classes/[id]/analytics/[quizId]`) —
 * the per-(class, quiz) view, not the quiz's cross-class one, because a reader
 * who got here by picking a class is asking about this class.
 *
 * Completion is a fraction of the class (`12/28`), never a bare percentage: "43%"
 * hides both how many students that is and how big the class is, which are the
 * two things a teacher acts on. The score is a grade out of 100, the same way
 * every other screen speaks about scores.
 *
 * Searched and paged in the browser: the row set is one class's assignments,
 * already fetched whole for the charts above, so a second server round trip per
 * page would buy nothing.
 */
export function ClassQuizTable({
  classId,
  quizzes,
}: {
  classId: string;
  quizzes: ClassOverviewQuiz[];
}) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return quizzes;
    return quizzes.filter((q) => (q.title ?? "").toLowerCase().includes(needle));
  }, [quizzes, query]);

  const paged = usePagedList(visible, { pageSize: 10, resetKey: query });

  if (quizzes.length === 0) {
    return (
      <p className="glass p-5 text-sm text-[var(--body-subtle)]">
        עדיין לא הוקצו חידונים לכיתה זו.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div className="max-w-xs flex-1">
          <Field
            label="חיפוש חידון"
            name="class-quiz-search"
            type="search"
            value={query}
            placeholder="שם החידון"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {query && (
          <IconButton
            name="filterOff"
            label="ניקוי החיפוש"
            onClick={() => setQuery("")}
          />
        )}
      </div>

      {visible.length === 0 ? (
        <p className="glass p-5 text-sm text-[var(--body-subtle)]">
          לא נמצא חידון בשם הזה בכיתה.
        </p>
      ) : (
        <div className="glass">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-start">
              <caption className="sr-only">
                החידונים שהוקצו לכיתה, עם שיעור ההשלמה והציון הממוצע
              </caption>
              <thead>
                <tr className={ROW_BORDER}>
                  <th scope="col" className={HEAD_CELL}>
                    חידון
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    מצב
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    השלמות
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    ציון ממוצע
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    <span className="sr-only">אנליטיקה</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.slice.map((q, i) => {
                  const status = allocationStatus(q);
                  const href = `/dashboard/classes/${classId}/analytics/${q.quiz_id}`;
                  return (
                    <tr
                      key={q.quiz_id}
                      className={`${ROW_LINK} ${
                        i === paged.slice.length - 1 ? "" : ROW_BORDER
                      }`}
                    >
                      <th scope="row" className={ROW_HEAD}>
                        <Link
                          href={href}
                          className="block max-w-[22ch] truncate hover:text-[var(--fg-brand)]"
                        >
                          {q.title ?? "חידון ללא שם"}
                        </Link>
                        <span className="block text-xs font-normal text-[var(--body-subtle)]">
                          {q.question_count} שאלות
                        </span>
                      </th>
                      <td className={CELL}>
                        <Badge variant={status.variant}>
                          <Icon name={status.icon} size={12} />
                          {status.label}
                        </Badge>
                      </td>
                      <td className={CELL}>
                        {q.members_completed}/{q.member_count}
                      </td>
                      <td className={`${CELL} font-medium text-[var(--heading)]`}>
                        {grade(q.average_score)}
                      </td>
                      <td className={CELL}>
                        <Link
                          href={href}
                          aria-label={`אנליטיקה של ${q.title ?? "החידון"} בכיתה`}
                          className="inline-flex text-[var(--body-subtle)] hover:text-[var(--fg-brand)]"
                        >
                          <Icon name="chevronLeft" size={18} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-3">
            <Pager {...paged} label="ניווט בין החידונים" />
          </div>
        </div>
      )}
    </div>
  );
}

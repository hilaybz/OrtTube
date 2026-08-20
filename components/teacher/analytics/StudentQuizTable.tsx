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
import type { StudentAnalyticsQuiz } from "@/lib/analytics";
import { grade } from "./chartTheme";
import { CELL, HEAD_CELL, ROW_BORDER, ROW_HEAD, ROW_LINK } from "./tableStyles";

/**
 * Every quiz this student is exposed to, across the teacher's classes, with the
 * grade they were shown and the grade their class averaged on the same quiz.
 *
 * The score column is the LATEST completed attempt, not the best: it is the
 * grade the student sees on their own results page, so a teacher discussing it
 * with them is looking at the same number. A row leads to that quiz's breakdown
 * inside that class, which is where "why did they get this" is answerable.
 */
export function StudentQuizTable({ quizzes }: { quizzes: StudentAnalyticsQuiz[] }) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return quizzes;
    return quizzes.filter(
      (q) =>
        (q.title ?? "").toLowerCase().includes(needle) ||
        q.class_name.toLowerCase().includes(needle)
    );
  }, [quizzes, query]);

  const paged = usePagedList(visible, { pageSize: 10, resetKey: query });

  if (quizzes.length === 0) {
    return (
      <p className="glass p-5 text-sm text-[var(--body-subtle)]">
        עדיין לא הוקצו חידונים לכיתות של התלמיד/ה.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div className="max-w-xs flex-1">
          <Field
            label="חיפוש חידון"
            name="student-quiz-search"
            type="search"
            value={query}
            placeholder="שם החידון או הכיתה"
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
          לא נמצא חידון בשם הזה.
        </p>
      ) : (
        <div className="glass">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-start">
              <caption className="sr-only">
                החידונים של התלמיד/ה, עם הציון שלו/ה מול ממוצע הכיתה
              </caption>
              <thead>
                <tr className={ROW_BORDER}>
                  <th scope="col" className={HEAD_CELL}>
                    חידון
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    כיתה
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    מצב
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    ציון
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    ממוצע הכיתה
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    <span className="sr-only">אנליטיקה</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.slice.map((q, i) => {
                  const status = allocationStatus(q);
                  const href = `/dashboard/classes/${q.class_id}/analytics/${q.quiz_id}`;
                  return (
                    <tr
                      key={`${q.class_id}-${q.quiz_id}`}
                      className={`${ROW_LINK} ${
                        i === paged.slice.length - 1 ? "" : ROW_BORDER
                      }`}
                    >
                      <th scope="row" className={ROW_HEAD}>
                        <Link
                          href={href}
                          className="block max-w-[20ch] truncate hover:text-[var(--fg-brand)]"
                        >
                          {q.title ?? "חידון ללא שם"}
                        </Link>
                        <span className="block text-xs font-normal text-[var(--body-subtle)]">
                          {q.completed
                            ? `${q.attempt_count} ניסיונות`
                            : "לא הושלם"}
                        </span>
                      </th>
                      <td className={`${CELL} max-w-[16ch] truncate`}>
                        {q.class_name}
                      </td>
                      <td className={CELL}>
                        <Badge variant={status.variant}>
                          <Icon name={status.icon} size={12} />
                          {status.label}
                        </Badge>
                      </td>
                      <td className={`${CELL} font-medium text-[var(--heading)]`}>
                        {grade(q.latest_score)}
                      </td>
                      <td className={CELL}>{grade(q.class_average_score)}</td>
                      <td className={CELL}>
                        <Link
                          href={href}
                          aria-label={`אנליטיקה של ${q.title ?? "החידון"} בכיתה ${q.class_name}`}
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

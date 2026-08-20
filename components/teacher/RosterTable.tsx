"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Select } from "@/components/ui/Select";
import { Pager } from "@/components/ui/Pager";
import { usePagedList } from "@/components/ui/usePagedList";
import type { ClassRosterProgress } from "@/lib/analyticsProgress";
import { grade } from "./analytics/chartTheme";
import {
  CELL,
  HEAD_CELL,
  ROW_BORDER,
  ROW_HEAD,
  ROW_LINK,
} from "./analytics/tableStyles";
import { studentAnalyticsHref } from "./analyticsLinks";

/**
 * Per-student progress for one class: one row per current member, each linking
 * to that student's cross-class analytics view.
 *
 * The per-quiz results are behind a QUIZ PICKER rather than a column each. A
 * column per assigned quiz made the table's width a function of how much a
 * teacher had assigned — by mid-term it scrolled sideways forever, and the
 * columns a reader wanted were the ones off screen. One picked quiz, one column,
 * constant width, and the teacher says which quiz they are looking at.
 *
 * Searched and paged in the browser: the row set is one class's roster, already
 * fetched whole, so paging it server-side would add a round trip per page
 * without bounding anything that isn't already bounded by class size.
 */
export function RosterTable({ roster }: { roster: ClassRosterProgress }) {
  const { members } = roster;

  // Every member shares the same assignment set, so the first member with any
  // quizzes defines the picker's options.
  const quizOptions = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const m of members) {
      for (const q of m.quizzes) {
        if (!seen.has(q.quiz_id)) seen.set(q.quiz_id, q.title);
      }
    }
    return Array.from(seen, ([quiz_id, title]) => ({ quiz_id, title }));
  }, [members]);

  const [query, setQuery] = useState("");
  const [quizId, setQuizId] = useState(() => quizOptions[0]?.quiz_id ?? "");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return members;
    return members.filter(
      (m) =>
        (m.display_name ?? "").toLowerCase().includes(needle) ||
        m.email.toLowerCase().includes(needle)
    );
  }, [members, query]);

  const paged = usePagedList(visible, { pageSize: 10, resetKey: query });

  if (members.length === 0) {
    return (
      <p className="glass p-5 text-sm text-[var(--body-subtle)]">
        עדיין אין תלמידים בכיתה. לאחר צירוף תלמידים, ההתקדמות שלהם תופיע כאן.
      </p>
    );
  }

  const pickedTitle =
    quizOptions.find((q) => q.quiz_id === quizId)?.title ?? "חידון ללא שם";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="max-w-xs flex-1">
          <Field
            label="חיפוש תלמיד/ה"
            name="roster-search"
            type="search"
            value={query}
            placeholder="שם או אימייל"
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
        {quizOptions.length > 0 && (
          <Select
            label="תוצאה בחידון"
            name="roster-quiz"
            value={quizId}
            onChange={(e) => setQuizId(e.target.value)}
          >
            {quizOptions.map((q) => (
              <option key={q.quiz_id} value={q.quiz_id}>
                {q.title ?? "חידון ללא שם"}
              </option>
            ))}
          </Select>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="glass p-5 text-sm text-[var(--body-subtle)]">
          לא נמצא/ה תלמיד/ה בשם הזה בכיתה.
        </p>
      ) : (
        <div className="glass">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-start">
              <caption className="sr-only">
                התקדמות התלמידים בכיתה, עם התוצאה בחידון שנבחר
              </caption>
              <thead>
                <tr className={ROW_BORDER}>
                  <th scope="col" className={HEAD_CELL}>
                    תלמיד/ה
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    הושלמו
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    ציון ממוצע
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    {quizOptions.length > 0 ? pickedTitle : "תוצאה"}
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    <span className="sr-only">אנליטיקה</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.slice.map((m, i) => {
                  const picked = m.quizzes.find((q) => q.quiz_id === quizId);
                  const done =
                    picked?.completed &&
                    picked.best_num_correct != null &&
                    picked.best_num_questions != null;
                  const href = studentAnalyticsHref(m.student_id);
                  return (
                    <tr
                      key={m.student_id}
                      className={`${ROW_LINK} ${
                        i === paged.slice.length - 1 ? "" : ROW_BORDER
                      }`}
                    >
                      <th scope="row" className={ROW_HEAD}>
                        <Link
                          href={href}
                          className="block max-w-[24ch] truncate hover:text-[var(--fg-brand)]"
                        >
                          {m.display_name ?? m.email}
                        </Link>
                        {m.display_name && (
                          <span className="block truncate text-xs font-normal text-[var(--body-subtle)]">
                            {m.email}
                          </span>
                        )}
                      </th>
                      <td className={CELL}>
                        {m.quizzes_completed}/{m.total_assigned}
                      </td>
                      <td className={`${CELL} font-medium text-[var(--heading)]`}>
                        {grade(m.average_best_score)}
                      </td>
                      <td className={CELL}>
                        {done ? (
                          <span className="inline-flex items-center gap-1 font-medium text-[var(--fg-success)]">
                            <Icon name="check" size={16} />
                            {picked!.best_num_correct}/{picked!.best_num_questions}
                          </span>
                        ) : (
                          <span className="text-[var(--body-subtle)]">
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">לא הושלם</span>
                          </span>
                        )}
                      </td>
                      <td className={CELL}>
                        <Link
                          href={href}
                          aria-label={`אנליטיקה של ${m.display_name ?? m.email}`}
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
            <Pager {...paged} label="ניווט בין התלמידים" />
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Pager } from "@/components/ui/Pager";
import { usePagedList } from "@/components/ui/usePagedList";
import { allocationStatus } from "@/components/teacher/scheduleFormat";
import type { QuizAnalyticsClass } from "@/lib/analytics";
import { grade } from "./chartTheme";
import { CELL, HEAD_CELL, ROW_BORDER, ROW_HEAD, ROW_LINK } from "./tableStyles";

/**
 * Every class this quiz is assigned to, and how each one did with it.
 *
 * A `shared` quiz can be assigned by any same-school teacher, so some rows may
 * belong to a colleague's class. Those rows are shown — the author's aggregate
 * numbers already include them, and a class the author cannot open is exactly the
 * one that would otherwise make the total look wrong — but they carry the
 * colleague's name and NO drill-down link, because the per-class analytics RPC
 * would (correctly) deny the author a class they do not own.
 */
export function QuizClassTable({
  quizId,
  classes,
}: {
  quizId: string;
  classes: QuizAnalyticsClass[];
}) {
  const paged = usePagedList(classes, { pageSize: 10 });

  if (classes.length === 0) {
    return (
      <p className="glass p-5 text-sm text-[var(--body-subtle)]">
        החידון עדיין לא הוקצה לאף כיתה.
      </p>
    );
  }

  return (
    <div className="glass">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-start">
          <caption className="sr-only">
            הכיתות שהחידון הוקצה להן, עם שיעור ההשלמה והציון הממוצע בכל אחת
          </caption>
          <thead>
            <tr className={ROW_BORDER}>
              <th scope="col" className={HEAD_CELL}>
                כיתה
              </th>
              <th scope="col" className={HEAD_CELL}>
                מצב
              </th>
              <th scope="col" className={HEAD_CELL}>
                סיימו
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
            {paged.slice.map((c, i) => {
              const status = allocationStatus(c);
              const href = `/dashboard/classes/${c.class_id}/analytics/${quizId}`;
              return (
                <tr
                  key={c.class_id}
                  className={`${c.is_own_class ? ROW_LINK : ""} ${
                    i === paged.slice.length - 1 ? "" : ROW_BORDER
                  }`}
                >
                  <th scope="row" className={ROW_HEAD}>
                    <span className="block max-w-[22ch] truncate">{c.name}</span>
                    {!c.is_own_class && (
                      <span className="block text-xs font-normal text-[var(--body-subtle)]">
                        {c.teacher_name ?? "מורה אחר/ת"}
                      </span>
                    )}
                  </th>
                  <td className={CELL}>
                    <Badge variant={status.variant}>
                      <Icon name={status.icon} size={12} />
                      {status.label}
                    </Badge>
                  </td>
                  <td className={CELL}>
                    {c.students_completed}/{c.member_count}
                  </td>
                  <td className={`${CELL} font-medium text-[var(--heading)]`}>
                    {grade(c.average_score)}
                  </td>
                  <td className={CELL}>
                    {c.is_own_class ? (
                      <Link
                        href={href}
                        aria-label={`אנליטיקה של החידון בכיתה ${c.name}`}
                        className="inline-flex text-[var(--body-subtle)] hover:text-[var(--fg-brand)]"
                      >
                        <Icon name="chevronLeft" size={18} />
                      </Link>
                    ) : (
                      <span className="sr-only">כיתה של מורה אחר/ת</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 pb-3">
        <Pager {...paged} label="ניווט בין הכיתות" />
      </div>
    </div>
  );
}

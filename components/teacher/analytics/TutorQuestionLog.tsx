"use client";

import { useCallback, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { Pager } from "@/components/ui/Pager";
import { usePagedRpc } from "@/components/ui/usePagedList";
import type {
  TutorQuestionRow,
  TutorQuestionQuizFilter,
} from "@/lib/analytics";

/** Which scope this log is reading, mirroring `tutor_questions_page`. */
export interface TutorLogScope {
  studentId?: string;
  quizId?: string;
  classId?: string;
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/** "1:23" from a playhead position, or empty when the ask had no position. */
function timestamp(seconds: number | null): string {
  if (seconds == null || seconds < 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The questions students actually asked OrtAI, in scope, newest first.
 *
 * Server-paged: this log grows for as long as a class keeps working, so the
 * window comes from `tutor_questions_page` rather than a full list sliced in the
 * browser. The quiz filter is populated from the SAME response, so it can only
 * ever offer quizzes that actually have questions in this scope — a filter that
 * lists an option leading to an empty page is worse than no filter.
 *
 * A question asked while a quiz question was on screen is flagged: that is the
 * shape of a student fishing for the answer rather than for understanding, and
 * it is the one thing in this list a teacher should be able to spot without
 * reading every row.
 */
export function TutorQuestionLog({
  scope,
  title = "השאלות שנשאלו את OrtAI",
  showStudent = false,
  showQuizFilter = true,
  emptyMessage = "עדיין לא נשאלו שאלות את OrtAI כאן.",
}: {
  scope: TutorLogScope;
  title?: string;
  /** Attribute each row to a student — off inside a single student's own view. */
  showStudent?: boolean;
  showQuizFilter?: boolean;
  emptyMessage?: string;
}) {
  const [quizFilter, setQuizFilter] = useState("");
  const [filters, setFilters] = useState<TutorQuestionQuizFilter[]>([]);
  const [flagged, setFlagged] = useState(0);

  const load = useCallback(
    async ({ limit, offset }: { limit: number; offset: number }) => {
      const params = new URLSearchParams();
      if (scope.studentId) params.set("student", scope.studentId);
      // An explicit quiz filter narrows the scope; without one the scope's own
      // quiz (if any) still applies.
      const quiz = quizFilter || scope.quizId;
      if (quiz) params.set("quiz", quiz);
      if (scope.classId) params.set("class", scope.classId);
      params.set("limit", String(limit));
      params.set("offset", String(offset));

      const res = await fetch(`/api/analytics/tutor-questions?${params}`);
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error?.message ?? "טעינת השאלות נכשלה");
      }
      // The filter list describes the UNFILTERED scope, so it must not be
      // rebuilt from a narrowed response — that would strip the reader's way
      // back out of the filter they just chose.
      if (!quizFilter) {
        const incoming = body.quiz_filters as TutorQuestionQuizFilter[];
        setFilters((prev) =>
          prev.map((f) => f.quiz_id).join() === incoming.map((f) => f.quiz_id).join()
            ? prev
            : incoming
        );
      }
      setFlagged(body.flagged_count as number);
      return { rows: body.rows as TutorQuestionRow[], total: body.total as number };
    },
    [scope.studentId, scope.quizId, scope.classId, quizFilter]
  );

  const paged = usePagedRpc<TutorQuestionRow>(load, {
    pageSize: 10,
    resetKey: quizFilter,
  });

  const showFilter = showQuizFilter && filters.length > 1;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[var(--heading)]">{title}</h2>
          <p className="mt-0.5 text-sm text-[var(--body-subtle)]">
            {paged.total} שאלות
            {flagged > 0 && ` · ${flagged} נשאלו בזמן ששאלה הוצגה על המסך`}
          </p>
        </div>
        {showFilter && (
          <div className="flex items-end gap-2">
            <Select
              label="סינון לפי חידון"
              name="tutor-log-quiz"
              value={quizFilter}
              onChange={(e) => setQuizFilter(e.target.value)}
            >
              <option value="">כל החידונים</option>
              {filters.map((f) => (
                <option key={f.quiz_id} value={f.quiz_id}>
                  {f.title ?? "חידון ללא שם"} ({f.count})
                </option>
              ))}
            </Select>
            {quizFilter && (
              <IconButton
                name="filterOff"
                label="ניקוי הסינון"
                onClick={() => setQuizFilter("")}
              />
            )}
          </div>
        )}
      </div>

      {paged.error ? (
        <Alert variant="danger" title="לא ניתן לטעון את השאלות">
          <div className="flex flex-wrap items-center gap-3">
            <span>{paged.error}</span>
            <IconButton name="refresh" label="נסו שוב" onClick={paged.reload} />
          </div>
        </Alert>
      ) : paged.loading && paged.slice.length === 0 ? (
        <p className="glass flex items-center justify-center gap-2 p-6 text-sm text-[var(--body-subtle)]">
          <Spinner size={18} />
          טוען שאלות…
        </p>
      ) : paged.total === 0 ? (
        <p className="glass p-5 text-sm text-[var(--body-subtle)]">{emptyMessage}</p>
      ) : (
        <>
          <ul
            className={`flex flex-col gap-2 transition-opacity ${
              paged.loading ? "opacity-60" : ""
            }`}
          >
            {paged.slice.map((row) => (
              <li key={row.id} className="glass p-4">
                <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--body-subtle)]">
                  <span className="inline-flex items-center gap-1">
                    <Icon name="quiz" size={14} />
                    {row.quiz_title ?? "חידון ללא שם"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Icon name="class" size={14} />
                    {row.class_name}
                  </span>
                  {showStudent && (
                    <span className="inline-flex items-center gap-1">
                      <Icon name="student" size={14} />
                      {row.student_name ?? row.student_email ?? "תלמיד/ה שהוסר/ה"}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Icon name="clock" size={14} />
                    {new Date(row.created_at).toLocaleString("he-IL", DATE_FORMAT)}
                  </span>
                  {timestamp(row.position_seconds) && (
                    <span className="inline-flex items-center gap-1">
                      <Icon name="play" size={14} />
                      {timestamp(row.position_seconds)}
                    </span>
                  )}
                  {row.flagged && (
                    <Badge variant="warning">
                      <Icon name="warning" size={12} />
                      נשאלה מול שאלה פתוחה
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-[var(--heading)]">{row.prompt}</p>
                {row.flagged && row.question_prompt && (
                  <p className="mt-1.5 border-s-2 border-[var(--glass-border)] ps-3 text-xs text-[var(--body-subtle)]">
                    השאלה שהוצגה: {row.question_prompt}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <Pager {...paged} label="ניווט בין השאלות" />
        </>
      )}
    </section>
  );
}

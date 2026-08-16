"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { apiFetch, ApiError } from "@/lib/http";
import type { AssignedQuiz, TutorMode } from "@/lib/classes";
import { allocationState, type AllocationState } from "@/lib/allocationState";
import type { MyQuiz } from "@/lib/quiz";
import { TUTOR_MODE_LABELS } from "./labels";
import { QuizPreviewModal } from "@/components/teacher/library/QuizPreviewModal";
import {
  STATE_LABEL,
  STATE_VARIANT,
  formatWindowPart,
  fromDatetimeLocalValue,
} from "@/components/teacher/scheduleFormat";

/** One lifecycle section, in display order — matches `AllocationState`. */
const SECTION_ORDER: AllocationState[] = ["draft", "live", "scheduled", "done"];

const SECTION_LABEL: Record<AllocationState, string> = {
  draft: "מוסתרים",
  live: "פעילים",
  scheduled: "מתוזמנים",
  done: "הסתיימו",
};

/**
 * Sort key per section — soonest-relevant-date first, so a teacher scanning
 * the list sees what needs attention soonest at the top of each group.
 * No-date items sink to the end rather than sorting arbitrarily.
 */
function sectionSortValue(state: AllocationState, a: AssignedQuiz): number {
  switch (state) {
    case "live":
      return a.available_until ? new Date(a.available_until).getTime() : Infinity;
    case "scheduled":
      return a.available_from ? new Date(a.available_from).getTime() : Infinity;
    case "done":
      // Most-recently-closed first.
      return a.available_until ? -new Date(a.available_until).getTime() : Infinity;
    case "draft":
      // Newest-assigned first.
      return -new Date(a.assigned_at).getTime();
  }
}

/**
 * Buckets assigned quizzes into their four lifecycle sections and sorts each
 * — pure, so it's unit-testable without a DOM (mirrors
 * `sortNotYetAttempted`/`sortFinished` in `components/student/StudentFeed.tsx`).
 * Does not mutate `assigned`.
 */
export function groupAssignedByState(
  assigned: AssignedQuiz[],
  now: Date = new Date()
): Record<AllocationState, AssignedQuiz[]> {
  const groups: Record<AllocationState, AssignedQuiz[]> = {
    draft: [],
    live: [],
    scheduled: [],
    done: [],
  };
  for (const a of assigned) {
    groups[allocationState(a, now)].push(a);
  }
  for (const state of SECTION_ORDER) {
    groups[state] = [...groups[state]].sort(
      (a, b) => sectionSortValue(state, a) - sectionSortValue(state, b)
    );
  }
  return groups;
}

/**
 * Assigned-quizzes management for a class: four lifecycle sections (hidden /
 * live / scheduled / ended), an unassign action and a publish/draft toggle
 * per row, plus an "assign" modal that picks from the teacher's own quizzes
 * and sets `tutorMode` + `maxAttempts` + `published` + an optional scheduling
 * window. Mutations round-trip through `apiFetch` + `router.refresh()`.
 * Editing an existing allocation's settings (beyond the quick publish toggle)
 * is the quiz editor's job (`AllocationsSection`) — this class-side view is
 * for assigning and for the fast publish/unassign/analytics actions.
 *
 * Each row is itself a stretched link: it opens the quiz editor for a quiz
 * this teacher authored, or a read-only preview for an assigned `shared` quiz
 * someone else wrote (the editor would just reject them as `not_owner`).
 */
export function AssignedQuizzesSection({
  classId,
  assigned,
  myQuizzes,
}: {
  classId: string;
  assigned: AssignedQuiz[];
  myQuizzes: MyQuiz[];
}) {
  const router = useRouter();

  // Only quizzes not already assigned to this class are assignable.
  const available = useMemo(() => {
    const taken = new Set(assigned.map((a) => a.quiz_id));
    return myQuizzes.filter((q) => !taken.has(q.quiz_id));
  }, [assigned, myQuizzes]);

  const sections = useMemo(() => groupAssignedByState(assigned), [assigned]);

  const [open, setOpen] = useState(false);
  const [quizId, setQuizId] = useState("");
  const [tutorMode, setTutorMode] = useState<TutorMode>("hints");
  const [unlimited, setUnlimited] = useState(false);
  const [maxAttempts, setMaxAttempts] = useState("1");
  const [publishNow, setPublishNow] = useState(true);
  const [availableFrom, setAvailableFrom] = useState("");
  const [availableUntil, setAvailableUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [pending, setPending] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");

  // Read-only preview for an assigned shared quiz this teacher didn't author.
  const [previewQuizId, setPreviewQuizId] = useState<string | null>(null);

  function openAssign() {
    setQuizId(available[0]?.quiz_id ?? "");
    setTutorMode("hints");
    setUnlimited(false);
    setMaxAttempts("1");
    setPublishNow(true);
    setAvailableFrom("");
    setAvailableUntil("");
    setError("");
    setOpen(true);
  }

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    if (!quizId) {
      setError("יש לבחור חידון.");
      return;
    }
    let attempts: number | null = null;
    if (!unlimited) {
      const n = Number(maxAttempts);
      if (!Number.isInteger(n) || n < 1) {
        setError("מספר הניסיונות חייב להיות מספר שלם גדול מ־0.");
        return;
      }
      attempts = n;
    }
    const from = fromDatetimeLocalValue(availableFrom);
    const until = fromDatetimeLocalValue(availableUntil);
    if (from && until && from >= until) {
      setError("תחילת הזמינות חייבת להיות לפני סיומה.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/classes/${classId}/quizzes`, {
        method: "POST",
        body: JSON.stringify({
          quizId,
          tutorMode,
          maxAttempts: attempts,
          published: publishNow,
          availableFrom: from,
          availableUntil: until,
        }),
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "הקצאת החידון נכשלה.");
    } finally {
      setBusy(false);
    }
  }

  async function unassign(id: string) {
    setPending(id);
    setRowError("");
    try {
      await apiFetch(`/api/classes/${classId}/quizzes/${id}`, {
        method: "DELETE",
      });
      router.refresh();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "ביטול ההקצאה נכשל.");
    } finally {
      setPending(null);
    }
  }

  async function togglePublished(id: string, nextPublished: boolean) {
    setPending(id);
    setRowError("");
    try {
      await apiFetch(`/api/classes/${classId}/quizzes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ published: nextPublished }),
      });
      router.refresh();
    } catch (err) {
      setRowError(
        err instanceof ApiError ? err.message : "עדכון סטטוס הפרסום נכשל."
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-[var(--heading)]">
            חידונים מוקצים
          </h3>
          <Badge variant="gray">
            <span className="tabular-nums">{assigned.length}</span>
          </Badge>
        </div>
        <Button onClick={openAssign} disabled={available.length === 0}>
          <Icon name="book" size={16} />
          הקצאת חידון
        </Button>
      </div>

      {rowError && (
        <Alert variant="danger" title="שגיאה">
          {rowError}
        </Alert>
      )}

      {available.length === 0 && myQuizzes.length > 0 && assigned.length > 0 && (
        <p className="text-sm text-[var(--body-subtle)]">
          כל החידונים שלך כבר מוקצים לכיתה זו.
        </p>
      )}

      {assigned.length === 0 ? (
        <div className="glass p-5">
          {myQuizzes.length === 0 ? (
            <p className="text-[var(--body)]">
              אין לך עדיין חידונים.{" "}
              <Link
                href="/dashboard/quizzes"
                className="font-medium text-[var(--fg-brand)] underline hover:no-underline"
              >
                צרו חידון
              </Link>{" "}
              כדי להקצות אותו לכיתה.
            </p>
          ) : (
            <p className="text-[var(--body)]">
              עדיין לא הוקצו חידונים לכיתה זו. לחצו על &rdquo;הקצאת חידון&ldquo;
              כדי להתחיל.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {SECTION_ORDER.map((state) => {
            const rows = sections[state];
            if (rows.length === 0) return null;
            return (
              <div key={state} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-[var(--body)]">
                    {SECTION_LABEL[state]}
                  </h4>
                  <Badge variant="gray">
                    <span className="tabular-nums">{rows.length}</span>
                  </Badge>
                </div>
                <ul className="flex flex-col gap-3">
                  {rows.map((a) => (
                    <AssignedQuizRow
                      key={a.quiz_id}
                      classId={classId}
                      allocation={a}
                      state={state}
                      busy={pending === a.quiz_id}
                      onTogglePublished={() => togglePublished(a.quiz_id, !a.published)}
                      onUnassign={() => unassign(a.quiz_id)}
                      onPreview={() => setPreviewQuizId(a.quiz_id)}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <QuizPreviewModal
        key={previewQuizId ?? "none"}
        open={previewQuizId !== null}
        quizId={previewQuizId ?? ""}
        onClose={() => setPreviewQuizId(null)}
      />

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="הקצאת חידון"
      >
        <form onSubmit={assign} className="flex flex-col gap-4">
          {error && (
            <Alert variant="danger" title="לא ניתן להקצות">
              {error}
            </Alert>
          )}

          {available.length === 0 ? (
            <p className="text-[var(--body)]">
              אין חידונים זמינים להקצאה.
            </p>
          ) : (
            <>
              <Select
                label="חידון"
                name="quizId"
                value={quizId}
                onChange={(e) => setQuizId(e.target.value)}
              >
                {available.map((q) => (
                  <option key={q.quiz_id} value={q.quiz_id}>
                    {q.title ?? q.video_title ?? "חידון ללא כותרת"}
                  </option>
                ))}
              </Select>

              <Select
                label="מצב מורה־AI"
                name="tutorMode"
                value={tutorMode}
                onChange={(e) => setTutorMode(e.target.value as TutorMode)}
              >
                {(Object.keys(TUTOR_MODE_LABELS) as TutorMode[]).map((m) => (
                  <option key={m} value={m}>
                    {TUTOR_MODE_LABELS[m]}
                  </option>
                ))}
              </Select>

              <div className="flex flex-col gap-3">
                <Field
                  label="מספר ניסיונות מרבי"
                  name="maxAttempts"
                  type="number"
                  min={1}
                  step={1}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(e.target.value)}
                  disabled={unlimited}
                />
                <label className="flex items-center gap-2 text-sm text-[var(--body)]">
                  <input
                    type="checkbox"
                    checked={unlimited}
                    onChange={(e) => setUnlimited(e.target.checked)}
                    className="h-4 w-4 rounded-[var(--radius-sm)] border border-[var(--glass-border)] accent-[var(--brand)]"
                  />
                  ניסיונות ללא הגבלה
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--body)]">
                  <input
                    type="checkbox"
                    checked={publishNow}
                    onChange={(e) => setPublishNow(e.target.checked)}
                    className="h-4 w-4 rounded-[var(--radius-sm)] border border-[var(--glass-border)] accent-[var(--brand)]"
                  />
                  פרסום מיידי לתלמידים
                </label>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Field
                  label="זמין החל מ־ (אופציונלי)"
                  name="availableFrom"
                  type="datetime-local"
                  value={availableFrom}
                  onChange={(e) => setAvailableFrom(e.target.value)}
                />
                <Field
                  label="זמין עד (אופציונלי)"
                  name="availableUntil"
                  type="datetime-local"
                  value={availableUntil}
                  onChange={(e) => setAvailableUntil(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              ביטול
            </Button>
            <Button type="submit" disabled={busy || available.length === 0}>
              {busy && <Spinner size={16} />}
              הקצאה
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/**
 * One assignment row. Clickable via the stretched-link pattern (precedent:
 * `components/teacher/QuizCard.tsx`): a `Link`/button absolutely fills the
 * row, the visible content sits above it lifted to `z-20 pointer-events-none`
 * (the whole wrapper, not just a button — `.glass > *` in globals.css pins
 * every direct child to `z-index: 2`, so a lower z-index on one control alone
 * would stay trapped beneath that stacking context), and each real control
 * opts back in with `pointer-events-auto`.
 *
 * `allocation.is_own` decides the destination: your own quiz opens the
 * editor; an assigned shared quiz someone else authored opens the read-only
 * preview instead of dead-ending on the editor's "not yours" page.
 */
function AssignedQuizRow({
  classId,
  allocation: a,
  state,
  busy,
  onTogglePublished,
  onUnassign,
  onPreview,
}: {
  classId: string;
  allocation: AssignedQuiz;
  state: AllocationState;
  busy: boolean;
  onTogglePublished: () => void;
  onUnassign: () => void;
  onPreview: () => void;
}) {
  const heading = a.title ?? a.video_title ?? "חידון";
  const showAnalytics = state === "live" || state === "done";

  return (
    <li className="glass relative p-4">
      {a.is_own ? (
        <Link
          href={`/dashboard/quizzes/${a.quiz_id}/edit`}
          aria-label={`עריכת ${heading}`}
          className="absolute inset-0 z-10 rounded-[inherit]"
        />
      ) : (
        <button
          type="button"
          onClick={onPreview}
          aria-label={`תצוגה מקדימה של ${heading}`}
          className="absolute inset-0 z-10 rounded-[inherit]"
        />
      )}
      <div className="pointer-events-none relative z-20 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h4 className="truncate font-semibold text-[var(--heading)]">
            {heading}
          </h4>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATE_VARIANT[state]}>{STATE_LABEL[state]}</Badge>
            <Badge variant="gray">
              <span className="tabular-nums">{a.question_count}</span> שאלות
            </Badge>
            <Badge variant="brand">
              מורה־AI: {TUTOR_MODE_LABELS[a.tutor_mode]}
            </Badge>
            <Badge variant="gray">
              {a.max_attempts == null ? (
                "ניסיונות ללא הגבלה"
              ) : (
                <>
                  <span className="tabular-nums">{a.max_attempts}</span>{" "}
                  ניסיונות
                </>
              )}
            </Badge>
            {!a.is_own && (
              <Badge variant="gray">
                {a.author_name ? `מאת ${a.author_name}` : "משותף"}
              </Badge>
            )}
          </div>
          {(a.available_from || a.available_until) && (
            <p className="text-xs text-[var(--body-subtle)]">
              {a.available_from && `מ־${formatWindowPart(a.available_from)}`}
              {a.available_from && a.available_until && " · "}
              {a.available_until && `עד ${formatWindowPart(a.available_until)}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showAnalytics && (
            <Link
              href={`/dashboard/classes/${classId}/analytics/${a.quiz_id}`}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-sm font-medium text-[var(--fg-brand)] hover:bg-[var(--neutral-quaternary)]"
            >
              <Icon name="chart" size={16} />
              אנליטיקה
            </Link>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="pointer-events-auto"
            disabled={busy}
            onClick={onTogglePublished}
          >
            {busy ? (
              <Spinner size={16} />
            ) : a.published ? (
              "הסתרה מתלמידים"
            ) : (
              "הצגה לתלמידים"
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="pointer-events-auto text-[var(--fg-danger)]"
            disabled={busy}
            onClick={onUnassign}
          >
            {busy ? <Spinner size={16} /> : "ביטול הקצאה"}
          </Button>
        </div>
      </div>
    </li>
  );
}

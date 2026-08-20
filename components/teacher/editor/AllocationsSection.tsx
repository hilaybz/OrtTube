"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Spinner } from "@/components/ui/Spinner";
import { Alert } from "@/components/ui/Alert";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";
import { Pager } from "@/components/ui/Pager";
import { usePagedList } from "@/components/ui/usePagedList";
import { apiFetch, ApiError } from "@/lib/http";
import type { ClassRow, TutorMode } from "@/lib/classes";
import { allocationState } from "@/lib/allocationState";
import type { QuizAllocation } from "@/lib/allocations";
import { TUTOR_MODE_LABELS } from "@/components/teacher/classes/labels";
import { BulkAssignModal } from "./BulkAssignModal";
import {
  STATE_LABEL,
  STATE_VARIANT,
  formatWindowPart,
  toDatetimeLocalValue,
  fromDatetimeLocalValue,
} from "@/components/teacher/scheduleFormat";

// Allocation rows are tall (name, state, settings line), so a page is short.
const ALLOCATIONS_PAGE_SIZE = 5;

/**
 * Allocation management for a quiz, on the editor page (Epic 2A.3): every
 * class this quiz is allocated to, any state, with per-row publish toggle /
 * edit / unassign — plus bulk-assign to several new classes at once. The
 * quiz-side mirror of `AssignedQuizzesSection` (which does the same job from
 * a single class looking at its quizzes).
 *
 * `allocations` is a server read (`list_quiz_allocations`, fetched by the
 * edit page) rather than a client-side fetch-on-mount — same convention as
 * `AssignedQuizzesSection`'s `assigned` prop. Every mutation calls
 * `router.refresh()` so the server re-reads and hands back fresh data, rather
 * than this component owning its own copy of the list.
 */
export function AllocationsSection({
  quizId,
  classes,
  allocations,
}: {
  quizId: string;
  classes: ClassRow[];
  allocations: QuizAllocation[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<QuizAllocation | null>(null);
  const [unassigning, setUnassigning] = useState<QuizAllocation | null>(null);
  const paged = usePagedList(allocations, { pageSize: ALLOCATIONS_PAGE_SIZE });

  async function togglePublished(classId: string, next: boolean) {
    setPending(classId);
    setRowError("");
    try {
      await apiFetch(`/api/classes/${classId}/quizzes/${quizId}`, {
        method: "PATCH",
        body: JSON.stringify({ published: next }),
      });
      router.refresh();
    } catch (e) {
      setRowError(e instanceof ApiError ? e.message : "עדכון הפרסום נכשל.");
    } finally {
      setPending(null);
    }
  }

  async function confirmUnassign() {
    const target = unassigning;
    if (!target) return;
    setPending(target.class_id);
    setRowError("");
    try {
      await apiFetch(`/api/classes/${target.class_id}/quizzes/${quizId}`, {
        method: "DELETE",
      });
      setUnassigning(null);
      router.refresh();
    } catch (e) {
      setRowError(e instanceof ApiError ? e.message : "ביטול ההקצאה נכשל.");
      setUnassigning(null);
    } finally {
      setPending(null);
    }
  }

  const assignedClassIds = new Set(allocations.map((a) => a.class_id));
  const candidates = classes.filter((c) => !assignedClassIds.has(c.id));

  return (
    <GlassCard className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[var(--heading)]">
          הקצאות
          {allocations.length > 0 && (
            <span className="ms-2 text-sm font-normal text-[var(--body-subtle)] tabular-nums">
              {allocations.length}
            </span>
          )}
        </h2>
        <IconButton
          name="plus"
          label="הקצאה לכיתות"
          variant="brand"
          onClick={() => setBulkOpen(true)}
          disabled={classes.length === 0}
        />
      </div>

      {rowError && <Alert variant="danger">{rowError}</Alert>}

      {allocations.length === 0 ? (
        <p className="text-sm text-[var(--body)]">
          {classes.length === 0
            ? "אין לכם עדיין כיתות. צרו כיתה כדי להקצות אליה חידונים."
            : "החידון עדיין לא הוקצה לאף כיתה."}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {paged.slice.map((a) => {
              const state = allocationState(a);
              const busy = pending === a.class_id;
              return (
                <li
                  key={a.class_id}
                  className="rounded-[var(--radius)] border border-[var(--glass-border)] p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-[var(--heading)]">
                          {a.class_name}
                        </span>
                        <Badge variant={STATE_VARIANT[state]}>{STATE_LABEL[state]}</Badge>
                      </div>
                      {/* The settings behind the row, as one quiet line rather
                          than a badge wall: they are context, not status. */}
                      <p className="text-xs text-[var(--body-subtle)]">
                        {[
                          `מורה־AI: ${TUTOR_MODE_LABELS[a.tutor_mode]}`,
                          a.max_attempts == null
                            ? "ניסיונות ללא הגבלה"
                            : `${a.max_attempts} ניסיונות`,
                          a.available_from
                            ? `מ־${formatWindowPart(a.available_from)}`
                            : null,
                          a.available_until
                            ? `עד ${formatWindowPart(a.available_until)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <IconButton
                        name={a.published ? "eyeOff" : "eye"}
                        label={a.published ? "הסתרה מתלמידים" : "הצגה לתלמידים"}
                        busy={busy}
                        onClick={() => togglePublished(a.class_id, !a.published)}
                      />
                      <IconButton
                        name="edit"
                        label="עריכת ההקצאה"
                        disabled={busy}
                        onClick={() => setEditing(a)}
                      />
                      <IconButton
                        name="trash"
                        label="ביטול הקצאה"
                        variant="danger"
                        disabled={busy}
                        onClick={() => setUnassigning(a)}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <Pager {...paged} label="ניווט בין הקצאות" />
        </>
      )}

      <BulkAssignModal
        open={bulkOpen}
        quizId={quizId}
        candidates={candidates}
        onClose={() => setBulkOpen(false)}
        onAssigned={() => router.refresh()}
      />

      <Modal
        open={unassigning !== null}
        title="ביטול הקצאה"
        onClose={() => {
          if (pending === null) setUnassigning(null);
        }}
      >
        <p className="text-sm text-[var(--body)]">
          לבטל את ההקצאה של החידון ל{unassigning?.class_name}? התלמידים לא יראו
          אותו יותר. תשובות ונתוני אנליטיקה של תלמידים שכבר פתרו אותו יישמרו.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => setUnassigning(null)}
            disabled={pending !== null}
          >
            השארת ההקצאה
          </Button>
          <Button variant="danger" onClick={confirmUnassign} disabled={pending !== null}>
            {pending !== null && <Spinner size={16} />}
            ביטול הקצאה
          </Button>
        </div>
      </Modal>

      <EditAllocationModal
        allocation={editing}
        quizId={quizId}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </GlassCard>
  );
}

/**
 * Edit an existing allocation's tutor mode / attempts / published / window in
 * one form, pre-filled from the current row. Submits the FULL settings object
 * through the assign upsert (`assign_quiz_to_class`) — a partial call would
 * silently reset whatever's omitted back to its default, which is exactly why
 * the row's quick publish toggle uses the dedicated PATCH endpoint instead of
 * this modal.
 *
 * Just the `Modal` chrome here; the form is a separate component keyed by
 * `allocation.class_id` (below) so switching which allocation is being edited
 * remounts it with fresh initial state — the React-idiomatic way to
 * "re-seed a form when its target prop changes," instead of an effect that
 * calls setState to sync them (which the lint rules flag: it's an extra
 * render pass to fix up state React could have started with correctly).
 */
function EditAllocationModal({
  allocation,
  quizId,
  onClose,
  onSaved,
}: {
  allocation: QuizAllocation | null;
  quizId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  if (!allocation) return null;
  return (
    <Modal open title={`עריכת הקצאה · ${allocation.class_name}`} onClose={onClose}>
      <EditAllocationForm
        key={allocation.class_id}
        allocation={allocation}
        quizId={quizId}
        onClose={onClose}
        onSaved={onSaved}
      />
    </Modal>
  );
}

function EditAllocationForm({
  allocation,
  quizId,
  onClose,
  onSaved,
}: {
  allocation: QuizAllocation;
  quizId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tutorMode, setTutorMode] = useState<TutorMode>(allocation.tutor_mode);
  const [unlimited, setUnlimited] = useState(allocation.max_attempts == null);
  const [maxAttempts, setMaxAttempts] = useState(String(allocation.max_attempts ?? 1));
  const [published, setPublished] = useState(allocation.published);
  const [availableFrom, setAvailableFrom] = useState(
    toDatetimeLocalValue(allocation.available_from)
  );
  const [availableUntil, setAvailableUntil] = useState(
    toDatetimeLocalValue(allocation.available_until)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
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
      await apiFetch(`/api/classes/${allocation.class_id}/quizzes`, {
        method: "POST",
        body: JSON.stringify({
          quizId,
          tutorMode,
          maxAttempts: attempts,
          published,
          availableFrom: from,
          availableUntil: until,
        }),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "השמירה נכשלה.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
        {error && (
          <Alert variant="danger" title="לא ניתן לשמור">
            {error}
          </Alert>
        )}
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
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
              className="h-4 w-4 rounded-[var(--radius-sm)] border border-[var(--glass-border)] accent-[var(--brand)]"
            />
            פורסם לתלמידים
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
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            ביטול
          </Button>
          <Button type="button" onClick={save} disabled={busy}>
            {busy && <Spinner size={16} />}
            שמירה
          </Button>
        </div>
    </div>
  );
}

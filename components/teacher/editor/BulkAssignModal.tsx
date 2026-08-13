"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Alert } from "@/components/ui/Alert";
import { apiFetch, ApiError } from "@/lib/http";
import type { ClassRow, TutorMode } from "@/lib/classes";
import type { BulkAssignResult } from "@/lib/allocations";
import { TUTOR_MODE_LABELS } from "@/components/teacher/classes/labels";
import { fromDatetimeLocalValue } from "@/components/teacher/scheduleFormat";

/**
 * Assign a quiz to several classes at once: pick classes as toggled chips,
 * set ONE shared set of delivery settings, submit. Each becomes its own
 * independent allocation (server-side loop over the same
 * `assign_quiz_to_class` RPC the single-class flow uses), editable
 * individually afterward from the allocations list — this modal is only the
 * fast path for setting several up identically to start.
 */
export function BulkAssignModal({
  open,
  quizId,
  candidates,
  onClose,
  onAssigned,
}: {
  open: boolean;
  quizId: string;
  /** Classes not yet allocated this quiz — the only ones selectable. */
  candidates: ClassRow[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tutorMode, setTutorMode] = useState<TutorMode>("hints");
  const [unlimited, setUnlimited] = useState(false);
  const [maxAttempts, setMaxAttempts] = useState("1");
  const [publishNow, setPublishNow] = useState(true);
  const [availableFrom, setAvailableFrom] = useState("");
  const [availableUntil, setAvailableUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState<{ classId: string; code: string }[]>([]);

  function reset() {
    setSelected(new Set());
    setTutorMode("hints");
    setUnlimited(false);
    setMaxAttempts("1");
    setPublishNow(true);
    setAvailableFrom("");
    setAvailableUntil("");
    setError("");
    setFailed([]);
  }

  function toggle(classId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0) {
      setError("יש לבחור לפחות כיתה אחת.");
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
    setFailed([]);
    try {
      const result = await apiFetch<BulkAssignResult>(
        `/api/quizzes/${quizId}/allocations`,
        {
          method: "POST",
          body: JSON.stringify({
            classIds: [...selected],
            tutorMode,
            maxAttempts: attempts,
            published: publishNow,
            availableFrom: from,
            availableUntil: until,
          }),
        }
      );
      if (result.failed.length > 0) {
        // Partial success: surface which classes failed rather than pretending
        // every selection went through, and prune the succeeded ones out of
        // the selection — otherwise a retry re-sends this modal's (possibly
        // now-stale) settings to classes that already got assigned, silently
        // resetting them instead of leaving well enough alone.
        setFailed(result.failed);
        const failedIds = new Set(result.failed.map((f) => f.classId));
        setSelected((prev) => new Set([...prev].filter((id) => failedIds.has(id))));
      }
      if (result.assigned.length > 0) {
        onAssigned();
      }
      if (result.failed.length === 0) {
        reset();
        onClose();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "ההקצאה נכשלה.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="הקצאה לכיתות"
      onClose={() => {
        if (!busy) {
          reset();
          onClose();
        }
      }}
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert variant="danger" title="לא ניתן להקצות">
            {error}
          </Alert>
        )}
        {failed.length > 0 && (
          <Alert variant="warning" title="חלק מההקצאות נכשלו">
            {failed.length} מתוך {selected.size} הקצאות לא הושלמו. נסו שוב עבור
            הכיתות שנותרו.
          </Alert>
        )}

        {candidates.length === 0 ? (
          <p className="text-[var(--body)]">
            החידון כבר מוקצה לכל הכיתות שלכם.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-[var(--heading)]">כיתות</span>
              <div className="flex flex-wrap gap-2">
                {candidates.map((c) => (
                  <Pill
                    key={c.id}
                    active={selected.has(c.id)}
                    onClick={() => toggle(c.id)}
                  >
                    {c.name}
                  </Pill>
                ))}
              </div>
            </div>

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
            onClick={() => {
              if (!busy) {
                reset();
                onClose();
              }
            }}
            disabled={busy}
          >
            ביטול
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={busy || candidates.length === 0}
          >
            {busy && <Spinner size={16} />}
            הקצאה
          </Button>
        </div>
      </div>
    </Modal>
  );
}

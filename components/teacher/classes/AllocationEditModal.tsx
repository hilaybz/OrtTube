"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { apiFetch, ApiError } from "@/lib/http";
import type { AssignedQuiz, TutorMode } from "@/lib/classes";
import {
  toDatetimeLocalValue,
  fromDatetimeLocalValue,
} from "@/components/teacher/scheduleFormat";
import { TUTOR_MODE_LABELS } from "./labels";

/**
 * Edit one allocation's settings from the class side: tutor mode, attempts,
 * visibility and the scheduling window — the same affordance the quiz editor's
 * הקצאות list offers from the other direction, so a teacher who found the quiz
 * through the class doesn't have to leave to change how it is assigned.
 *
 * Submits the FULL settings object through the assign upsert
 * (`assign_quiz_to_class`), because a partial call resets whatever it omits to
 * that field's default. Everything the form can change is therefore on screen
 * and pre-filled; that is also why the row's quick visibility toggle uses the
 * single-purpose PATCH endpoint instead of this modal.
 */
export function AllocationEditModal({
  classId,
  allocation,
  onClose,
  onSaved,
}: {
  classId: string;
  /** `null` closes the modal; a value both opens it and seeds the form. */
  allocation: AssignedQuiz | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  if (!allocation) return null;
  const heading = allocation.title ?? allocation.video_title ?? "חידון";
  return (
    <Modal open title={`עריכת הקצאה · ${heading}`} onClose={onClose}>
      {/* Keyed by quiz so switching rows remounts the form with fresh initial
          state, rather than syncing props into state from an effect. */}
      <AllocationEditForm
        key={allocation.quiz_id}
        classId={classId}
        allocation={allocation}
        onClose={onClose}
        onSaved={onSaved}
      />
    </Modal>
  );
}

function AllocationEditForm({
  classId,
  allocation,
  onClose,
  onSaved,
}: {
  classId: string;
  allocation: AssignedQuiz;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tutorMode, setTutorMode] = useState<TutorMode>(allocation.tutor_mode);
  const [unlimited, setUnlimited] = useState(allocation.max_attempts == null);
  const [maxAttempts, setMaxAttempts] = useState(
    String(allocation.max_attempts ?? 1)
  );
  const [published, setPublished] = useState(allocation.published);
  const [availableFrom, setAvailableFrom] = useState(
    toDatetimeLocalValue(allocation.available_from)
  );
  const [availableUntil, setAvailableUntil] = useState(
    toDatetimeLocalValue(allocation.available_until)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
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
          quizId: allocation.quiz_id,
          tutorMode,
          maxAttempts: attempts,
          published,
          availableFrom: from,
          availableUntil: until,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
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
          מוצג לתלמידים
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
        <Button type="submit" disabled={busy}>
          {busy && <Spinner size={16} />}
          שמירה
        </Button>
      </div>
    </form>
  );
}

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
import type { MyQuiz } from "@/lib/quiz";
import { TUTOR_MODE_LABELS } from "./labels";

/**
 * Assigned-quizzes management for a class: list assignments with their delivery
 * settings (tutor mode + attempt cap) and an unassign action, plus an "assign"
 * modal that picks from the teacher's own quizzes and sets `tutorMode` +
 * `maxAttempts`. Mutations round-trip through `apiFetch` + `router.refresh()`.
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

  const [open, setOpen] = useState(false);
  const [quizId, setQuizId] = useState("");
  const [tutorMode, setTutorMode] = useState<TutorMode>("hints");
  const [unlimited, setUnlimited] = useState(false);
  const [maxAttempts, setMaxAttempts] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [pending, setPending] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");

  function openAssign() {
    setQuizId(available[0]?.quiz_id ?? "");
    setTutorMode("hints");
    setUnlimited(false);
    setMaxAttempts("1");
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
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/classes/${classId}/quizzes`, {
        method: "POST",
        body: JSON.stringify({ quizId, tutorMode, maxAttempts: attempts }),
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
        <ul className="flex flex-col gap-3">
          {assigned.map((a) => {
            const busyRow = pending === a.quiz_id;
            return (
              <li key={a.quiz_id} className="glass p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-2">
                    <h4 className="truncate font-semibold text-[var(--heading)]">
                      {a.title ?? a.video_title ?? "חידון"}
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="gray">
                        <span className="tabular-nums">{a.question_count}</span>{" "}
                        שאלות
                      </Badge>
                      <Badge variant="brand">
                        מורה־AI: {TUTOR_MODE_LABELS[a.tutor_mode]}
                      </Badge>
                      <Badge variant="gray">
                        {a.max_attempts == null ? (
                          "ניסיונות ללא הגבלה"
                        ) : (
                          <>
                            <span className="tabular-nums">
                              {a.max_attempts}
                            </span>{" "}
                            ניסיונות
                          </>
                        )}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[var(--fg-danger)]"
                    disabled={busyRow}
                    onClick={() => unassign(a.quiz_id)}
                  >
                    {busyRow ? <Spinner size={16} /> : "ביטול הקצאה"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

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

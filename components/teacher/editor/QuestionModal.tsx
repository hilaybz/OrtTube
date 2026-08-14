"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { Icon } from "@/components/ui/Icon";
import { apiFetch, ApiError } from "@/lib/http";
import type { AuthorQuestion, QuestionKind } from "@/lib/quizAuthor";
import { deleteOption, MutationError } from "./mutations";
import { formatTime, parseTime } from "./format";

interface DraftOption {
  /** Local, stable key for React (not the DB id). */
  key: string;
  /** Present once persisted; drives update-vs-insert in `upsert_question`. */
  option_id?: string;
  text: string;
  is_correct: boolean;
}

let keySeq = 0;
function newKey(): string {
  keySeq += 1;
  return `opt-${keySeq}`;
}

function draftFrom(question: AuthorQuestion | null): {
  kind: QuestionKind;
  position: string;
  prompt: string;
  explanation: string;
  options: DraftOption[];
} {
  if (!question) {
    return {
      kind: "single",
      position: "",
      prompt: "",
      explanation: "",
      options: [
        { key: newKey(), text: "", is_correct: true },
        { key: newKey(), text: "", is_correct: false },
      ],
    };
  }
  return {
    kind: question.kind,
    position: formatTime(question.position_seconds),
    prompt: question.prompt ?? "",
    explanation: question.explanation ?? "",
    options: question.options.map((o) => ({
      key: newKey(),
      option_id: o.id,
      text: o.text ?? "",
      is_correct: o.is_correct,
    })),
  };
}

/**
 * Add / edit one question. Text, kind, position and the option set (add, edit,
 * reorder, correctness) are saved atomically via `POST /api/quizzes/[id]/questions`
 * (`upsert_question`). Deleting a PERSISTED option is an immediate owner-checked
 * `soft_delete_option` call (backstopped by the last-correct constraint), so the
 * save only ever sends the live set and the answer key stays consistent.
 */
export function QuestionModal({
  open,
  quizId,
  question,
  nextOrderIndex,
  currentPlayerSeconds = null,
  onClose,
  onSaved,
}: {
  open: boolean;
  quizId: string;
  question: AuthorQuestion | null;
  nextOrderIndex: number;
  /** The editor's preview-player position, if known yet — powers the "use
   * current time" shortcut below. `null` while the player hasn't reported a
   * position yet, so the button never claims a fabricated 0:00. */
  currentPlayerSeconds?: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<QuestionKind>("single");
  const [position, setPosition] = useState("");
  const [prompt, setPrompt] = useState("");
  const [explanation, setExplanation] = useState("");
  const [options, setOptions] = useState<DraftOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset the form whenever the modal opens for a (possibly different) question.
  // Done during render rather than in an effect (React 19 guidance): track the
  // identity of the current open session and re-seed the draft when it changes,
  // clearing it on close so reopening the same question starts fresh.
  const openId = question?.id ?? "new";
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (open && seededFor !== openId) {
    const d = draftFrom(question);
    setKind(d.kind);
    setPosition(d.position);
    setPrompt(d.prompt);
    setExplanation(d.explanation);
    setOptions(d.options);
    setError(null);
    setBusy(false);
    setSeededFor(openId);
  } else if (!open && seededFor !== null) {
    setSeededFor(null);
  }

  function setCorrect(key: string) {
    // single → exactly one correct; multi → toggle.
    setOptions((prev) =>
      prev.map((o) => {
        if (kind === "single") return { ...o, is_correct: o.key === key };
        return o.key === key ? { ...o, is_correct: !o.is_correct } : o;
      })
    );
  }

  function setKindAndFix(next: QuestionKind) {
    setKind(next);
    if (next === "single") {
      // Collapse to a single correct answer (keep the first currently-correct).
      setOptions((prev) => {
        const firstCorrect = prev.find((o) => o.is_correct)?.key ?? prev[0]?.key;
        return prev.map((o) => ({ ...o, is_correct: o.key === firstCorrect }));
      });
    }
  }

  function addOption() {
    setOptions((prev) => [...prev, { key: newKey(), text: "", is_correct: false }]);
  }

  async function removeOption(target: DraftOption) {
    setError(null);
    // Persisted option → owner-checked soft-delete now; local-only → just drop it.
    if (target.option_id) {
      setBusy(true);
      try {
        await deleteOption(target.option_id);
      } catch (e) {
        setError(e instanceof MutationError ? e.message : "מחיקת האפשרות נכשלה.");
        setBusy(false);
        return;
      }
      setBusy(false);
      onSaved(); // refresh underlying data
    }
    setOptions((prev) => prev.filter((o) => o.key !== target.key));
  }

  async function save() {
    setError(null);

    const seconds = parseTime(position);
    if (seconds === null) {
      setError("יש להזין נקודת עצירה תקינה בפורמט דקות:שניות.");
      return;
    }
    if (prompt.trim().length === 0) {
      setError("יש להזין ניסוח לשאלה.");
      return;
    }
    const filled = options.filter((o) => o.text.trim().length > 0);
    if (filled.length < 2) {
      setError("יש להזין לפחות שתי אפשרויות תשובה.");
      return;
    }
    const correctCount = filled.filter((o) => o.is_correct).length;
    if (kind === "single" && correctCount !== 1) {
      setError("בשאלה עם תשובה אחת יש לסמן בדיוק אפשרות נכונה אחת.");
      return;
    }
    if (kind === "multi" && correctCount < 1) {
      setError("יש לסמן לפחות אפשרות נכונה אחת.");
      return;
    }

    setBusy(true);
    try {
      await apiFetch(`/api/quizzes/${quizId}/questions`, {
        method: "POST",
        body: JSON.stringify({
          questionId: question?.id,
          kind,
          positionSeconds: seconds,
          orderIndex: question?.order_index ?? nextOrderIndex,
          basePrompt: prompt.trim(),
          baseExplanation: explanation.trim() || null,
          options: filled.map((o, i) => ({
            option_id: o.option_id,
            is_correct: o.is_correct,
            order_index: i,
            base_text: o.text.trim(),
          })),
        }),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "שמירת השאלה נכשלה.");
      setBusy(false);
    }
  }

  const labelCls = "block text-sm font-medium text-[var(--heading)] mb-2";
  const controlCls =
    "w-full rounded-[var(--radius)] bg-[var(--glass-bg)] px-3 py-2.5 text-sm text-[var(--heading)] border border-[var(--glass-border)] outline-none backdrop-blur-[20px] transition-colors placeholder:text-[var(--body)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={question ? "עריכת שאלה" : "שאלה חדשה"}
      className="max-w-2xl"
    >
      <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pe-1">
        {error && <Alert variant="danger">{error}</Alert>}

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className={labelCls}>סוג שאלה</span>
            <SegmentedToggle<QuestionKind>
              ariaLabel="סוג שאלה"
              value={kind}
              onChange={setKindAndFix}
              segments={[
                { value: "single", label: "תשובה אחת" },
                { value: "multi", label: "מספר תשובות" },
              ]}
            />
          </div>
          <div className="w-36">
            <label htmlFor="q-position" className={labelCls}>
              נקודת עצירה
            </label>
            <input
              id="q-position"
              className={controlCls}
              placeholder="0:30"
              inputMode="numeric"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
          </div>
        </div>

        {currentPlayerSeconds != null && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setPosition(formatTime(currentPlayerSeconds))}
          >
            <Icon name="clock" size={14} />
            מהזמן הנוכחי בנגן ({formatTime(currentPlayerSeconds)})
          </Button>
        )}

        <div>
          <label htmlFor="q-prompt" className={labelCls}>
            ניסוח השאלה
          </label>
          <textarea
            id="q-prompt"
            className={controlCls}
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div>
          <span className={labelCls}>אפשרויות תשובה</span>
          <p className="mb-3 -mt-1 text-xs text-[var(--body-subtle)]">
            {kind === "single"
              ? "סמנו את האפשרות הנכונה היחידה."
              : "סמנו את כל האפשרויות הנכונות."}
          </p>
          <ul className="flex flex-col gap-2">
            {options.map((o) => (
              <li key={o.key} className="flex items-center gap-2">
                <input
                  type={kind === "single" ? "radio" : "checkbox"}
                  name="q-correct"
                  aria-label="אפשרות נכונה"
                  checked={o.is_correct}
                  onChange={() => setCorrect(o.key)}
                  className="h-4 w-4 shrink-0 accent-[var(--brand)]"
                />
                <input
                  className={controlCls}
                  placeholder="טקסט האפשרות"
                  value={o.text}
                  onChange={(e) =>
                    setOptions((prev) =>
                      prev.map((x) =>
                        x.key === o.key ? { ...x, text: e.target.value } : x
                      )
                    )
                  }
                />
                <button
                  type="button"
                  aria-label="מחיקת אפשרות"
                  onClick={() => removeOption(o)}
                  disabled={busy || options.length <= 2}
                  className="shrink-0 rounded-[var(--radius-sm)] p-2 text-[var(--body)] hover:bg-[var(--neutral-quaternary)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={addOption}
            disabled={busy}
          >
            הוספת אפשרות
          </Button>
        </div>

        <div>
          <label htmlFor="q-explanation" className={labelCls}>
            הסבר (מוצג לאחר המענה) — אופציונלי
          </label>
          <textarea
            id="q-explanation"
            className={controlCls}
            rows={2}
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-5 flex items-center justify-end gap-3 border-t border-[var(--glass-border-subtle)] pt-4">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          ביטול
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy ? <Spinner size={18} /> : "שמירה"}
        </Button>
      </div>
    </Modal>
  );
}

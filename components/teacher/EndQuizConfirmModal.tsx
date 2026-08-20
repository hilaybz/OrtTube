"use client";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

/**
 * Shared "end this quiz for the class now" confirmation — used by both
 * `AssignedQuizzesSection` (class page) and `AllocationsSection` (quiz
 * editor), one copy so the two can't drift.
 *
 * Ending a quiz is implemented as setting `available_until` to right now —
 * the exact same window-close mechanism a scheduled end already triggers, so
 * everything this modal describes is EXISTING, already-shipped behavior
 * (`submit_answer`/`complete_attempt`'s hard cutoff; `list_student_feed`'s
 * `missed` status), not new grading logic. The copy explains that reality
 * rather than describing something novel.
 */
export function EndQuizConfirmModal({
  open,
  prompt,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  /**
   * The confirmation's first line — worded per caller, since "what's ending"
   * reads differently depending on which side is the varying one: the class
   * page's row list varies by QUIZ (within one class), the editor's own
   * allocation row list varies by CLASS (for one quiz).
   */
  prompt: React.ReactNode;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title="סיום שאלון"
      onClose={() => !busy && onClose()}
    >
      <p className="text-sm text-[var(--body)]">{prompt}</p>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm text-[var(--body)]">
        <li>
          · תלמידים שנמצאים כרגע באמצע ניסיון יסיימו אוטומטית עם התשובות
          שנשלחו עד כה — שאלות שלא נענו ייחשבו כלא נכונות.
        </li>
        <li>· תלמידים שטרם התחילו יסומנו כמי שפספסו את השאלון.</li>
      </ul>
      <p className="mt-3 text-xs text-[var(--body-subtle)]">
        אפשר לפתוח את השאלון שוב לכיתה בכל עת, אך לא לבטל את הסיום עצמו.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          ביטול
        </Button>
        <Button type="button" onClick={onConfirm} disabled={busy}>
          {busy && <Spinner size={16} />}
          סיום השאלון
        </Button>
      </div>
    </Modal>
  );
}

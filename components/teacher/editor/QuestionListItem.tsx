import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/IconButton";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/components/ui/cn";
import type { AuthorQuestion } from "@/lib/quizAuthor";
import { formatTime } from "./format";

/**
 * One question's card: position/kind/correctness-count badge row, prompt,
 * and its options with correctness shown (check/x icon by `is_correct`).
 *
 * Extracted out of `QuizEditor.tsx` so the read-only quiz preview
 * (`QuizPreviewModal.tsx`, backlog 1.3) renders through the EXACT same
 * component instead of a separately-maintained lookalike — `onEdit`/
 * `onDelete` are optional specifically so the preview can omit them and get
 * a read-only card for free, with zero visual drift from the editor.
 */
export function QuestionListItem({
  question: q,
  active,
  cardRef,
  onEdit,
  onDelete,
}: {
  question: AuthorQuestion;
  active: boolean;
  /** Populates the caller's scroll-into-view ref map (e.g. on a marker click). */
  cardRef?: (el: HTMLLIElement | null) => void;
  /** Omit for a read-only card — the edit action then doesn't render. */
  onEdit?: () => void;
  /** Omit for a read-only card — the delete action then doesn't render. */
  onDelete?: () => void;
}) {
  const correct = q.options.filter((o) => o.is_correct).length;
  return (
    <li ref={cardRef}>
      <GlassCard
        className={cn(
          "flex flex-col gap-3 transition-shadow",
          active && "ring-2 ring-[var(--brand)] ring-offset-2"
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="gray" pill>
            <Icon name="clock" size={12} />
            {formatTime(q.position_seconds)}
          </Badge>
          <Badge variant="brand">
            {q.kind === "single" ? "תשובה אחת" : "מספר תשובות"}
          </Badge>
          <span className="text-xs text-[var(--body-subtle)]">
            {q.options.length} אפשרויות · {correct} נכונות
          </span>
          {(onEdit || onDelete) && (
            <div className="ms-auto flex items-center gap-1">
              {onEdit && (
                <IconButton
                  name="edit"
                  label="עריכת השאלה"
                  size="sm"
                  onClick={onEdit}
                />
              )}
              {onDelete && (
                <IconButton
                  name="trash"
                  label="מחיקת השאלה"
                  size="sm"
                  variant="danger"
                  onClick={onDelete}
                />
              )}
            </div>
          )}
        </div>
        <p className="font-medium text-[var(--heading)]">
          {q.prompt ?? "(ללא ניסוח)"}
        </p>
        <ul className="flex flex-col gap-1">
          {q.options.map((o) => (
            <li
              key={o.id}
              className="flex items-center gap-2 text-sm text-[var(--body)]"
            >
              <Icon
                name={o.is_correct ? "check" : "close"}
                size={14}
                className={
                  o.is_correct ? "text-[var(--fg-success)]" : "text-[var(--body-subtle)]"
                }
              />
              {o.text ?? "(ללא טקסט)"}
            </li>
          ))}
        </ul>
        {q.explanation && (
          <p className="text-sm text-[var(--body-subtle)]">
            <span className="font-medium text-[var(--body)]">הסבר: </span>
            {q.explanation}
          </p>
        )}
      </GlassCard>
    </li>
  );
}

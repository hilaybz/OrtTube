import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/Icon";

export interface ReviewOption {
  id: string;
  text: string;
  correct: boolean;
  selected: boolean;
}
export interface ReviewItem {
  prompt: string;
  explanation: string | null;
  was_correct: boolean | null;
  options: ReviewOption[];
}

/** Per-question review, shown only once the reveal gate is satisfied. */
export function ReviewList({ items }: { items: ReviewItem[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {items.map((q, idx) => (
        <li key={idx} className="glass p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h3 className="font-semibold leading-snug text-[var(--heading)]">
              {idx + 1}. {q.prompt}
            </h3>
            <span
              className={cn(
                "inline-flex flex-none items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                q.was_correct
                  ? "border-[var(--success-soft)] bg-[var(--success-soft)] text-[var(--fg-success)]"
                  : "border-[var(--danger-soft)] bg-[var(--danger-soft)] text-[var(--fg-danger)]"
              )}
            >
              <Icon name={q.was_correct ? "check" : "close"} size={13} />
              {q.was_correct ? "נכון" : "שגוי"}
            </span>
          </div>

          <ul className="flex flex-col gap-2">
            {q.options.map((o) => {
              const state = o.correct
                ? "correct"
                : o.selected
                  ? "wrong"
                  : "neutral";
              return (
                <li
                  key={o.id}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[var(--radius-d)] border p-3 text-sm",
                    state === "correct" &&
                      "border-[var(--fg-success)] bg-[var(--success-soft)] text-[var(--fg-success)]",
                    state === "wrong" &&
                      "border-[var(--fg-danger)] bg-[var(--danger-soft)] text-[var(--fg-danger)]",
                    state === "neutral" && "border-[var(--glass-border)] bg-white/40"
                  )}
                >
                  {o.correct ? (
                    <Icon name="check" size={16} label="תשובה נכונה" />
                  ) : o.selected ? (
                    <Icon name="close" size={16} label="הבחירה שלך" />
                  ) : (
                    <span className="inline-block h-4 w-4" />
                  )}
                  <span>{o.text}</span>
                  {o.selected && (
                    <span className="ms-auto text-xs opacity-70">הבחירה שלך</span>
                  )}
                </li>
              );
            })}
          </ul>

          {q.explanation && (
            <p className="mt-3 rounded-[var(--radius-d)] bg-[var(--brand-softer)] p-3 text-sm text-[var(--fg-brand-strong)]">
              {q.explanation}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

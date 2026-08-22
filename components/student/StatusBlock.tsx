import { cn } from "@/components/ui/cn";
import { Icon, type IconName } from "@/components/ui/Icon";

/**
 * The one shape a student's "where does this quiz stand" line takes, wherever
 * it appears: an icon chip, a headline that answers the question, and a quiet
 * meta line with the detail behind it (a date, a wall-clock deadline).
 *
 * It exists because the answer differs per state but the reading shouldn't —
 * a finished quiz's grade, a missed one's closing date and an open one's
 * countdown all belong in the same slot of a card, at the same weight, so a
 * student scanning a feed compares them instead of re-learning each one. Only
 * the tone changes, and it carries meaning: green is done, amber is soon, red
 * is over, plain is "nothing pressing".
 */
export type StatusTone = "success" | "danger" | "warning" | "brand" | "neutral";

const TONE: Record<StatusTone, string> = {
  success: "border-[var(--success-soft)] bg-[var(--success-soft)] text-[var(--fg-success)]",
  danger: "border-[var(--danger-soft)] bg-[var(--danger-soft)] text-[var(--fg-danger)]",
  warning: "border-[var(--warning-soft)] bg-[var(--warning-soft)] text-[var(--fg-warning)]",
  brand: "border-[var(--brand-soft)] bg-[var(--brand-softer)] text-[var(--fg-brand-strong)]",
  neutral: "border-[var(--glass-border)] bg-white/50 text-[var(--body)]",
};

export function StatusBlock({
  icon,
  tone = "neutral",
  headline,
  meta,
  strong = false,
  className,
}: {
  icon: IconName;
  tone?: StatusTone;
  /** The answer itself — a grade, "היום", "לא הוגש". Carries the emphasis. */
  headline: React.ReactNode;
  /** The headline is this card's figure (a grade) rather than a phrase — size it up. */
  strong?: boolean;
  /** The detail behind it, in the quiet register: a date, a closing time. */
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[var(--radius-d)] border p-3",
        TONE[tone],
        className
      )}
    >
      <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-white/70">
        <Icon name={icon} size={18} />
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block leading-snug",
            strong ? "text-base font-bold" : "text-sm font-semibold"
          )}
        >
          {headline}
        </span>
        {meta && <span className="block text-xs opacity-80">{meta}</span>}
      </span>
    </div>
  );
}

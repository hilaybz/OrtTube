import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/Icon";

const RADIUS = 13;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * How far through the quiz's questions the student is, above the player: a
 * progress ring that fills as checkpoints are answered, with the count spelled
 * out beside it. A `progressbar` rather than loose text, so assistive tech gets
 * the same "3 of 5" the ring shows.
 */
export function QuizProgress({
  answered,
  total,
  className,
}: {
  answered: number;
  total: number;
  className?: string;
}) {
  const ratio = total > 0 ? Math.min(1, answered / total) : 0;
  const complete = total > 0 && answered >= total;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={answered}
      aria-valuetext={`${answered} מתוך ${total} שאלות`}
      className={cn(
        "inline-flex items-center gap-2.5 rounded-full border border-[var(--glass-border)] bg-white/60 py-1 pe-3.5 ps-1.5 shadow-[var(--shadow-xs)]",
        className
      )}
    >
      <span className="relative grid h-8 w-8 flex-none place-items-center">
        <svg viewBox="0 0 32 32" aria-hidden="true" className="h-8 w-8 -rotate-90">
          <circle
            cx="16"
            cy="16"
            r={RADIUS}
            fill="none"
            stroke="var(--neutral-quaternary)"
            strokeWidth="3"
          />
          <circle
            cx="16"
            cy="16"
            r={RADIUS}
            fill="none"
            stroke="var(--brand)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
            className="transition-[stroke-dashoffset] duration-500 ease-out"
          />
        </svg>
        <span
          aria-hidden="true"
          className="absolute text-[11px] font-bold text-[var(--fg-brand-strong)]"
        >
          {complete ? <Icon name="check" size={14} /> : answered}
        </span>
      </span>
      <span aria-hidden="true" className="text-xs leading-tight text-[var(--body)]">
        <span className="block font-semibold text-[var(--heading)]">
          {answered} מתוך {total}
        </span>
        שאלות
      </span>
    </div>
  );
}

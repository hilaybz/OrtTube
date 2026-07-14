"use client";
import { cn } from "./cn";

export interface Segment<T extends string> {
  value: T;
  label: string;
}

/**
 * A pill-group single-select (e.g. יומי / שבועי / חודשי). Controlled via
 * `value` + `onChange`. Rendered as a radiogroup for assistive tech.
 */
export function SegmentedToggle<T extends string>({
  segments,
  value,
  onChange,
  className,
  ariaLabel,
}: {
  segments: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex gap-1 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] p-1",
        className
      )}
    >
      {segments.map((s) => {
        const active = s.value === value;
        return (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(s.value)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-[var(--brand)] text-white"
                : "text-[var(--body)] hover:text-[var(--heading)]"
            )}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

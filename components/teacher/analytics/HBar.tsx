/**
 * One labelled horizontal bar. There is no charting library in this repo
 * (see `docs/data-model.md`/plan for `class_quiz_analytics`) — bars are a
 * plain width-percent `<div>`, the same primitive `CheckpointTimeline.tsx`
 * uses for its playhead fill. Growing from the inline-start edge makes this
 * RTL-correct for free — no `left`/`right` math needed.
 *
 * The count renders as visible text rather than only a bar width, so the
 * value is available to screen readers without extra ARIA wiring.
 */
export function HBar({
  label,
  count,
  total,
  variant = "brand",
}: {
  label: string;
  count: number;
  /** Denominator the bar's width is relative to; 0 renders an empty bar. */
  total: number;
  variant?: "brand" | "success";
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const fill =
    variant === "success" ? "bg-[var(--fg-success)]" : "bg-[var(--brand)]";

  return (
    <div className="flex items-center gap-3">
      <span className="w-28 flex-none truncate text-sm text-[var(--body)]">
        {label}
      </span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--neutral-quaternary)]">
        <div
          className={`h-full rounded-full ${fill}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-16 flex-none text-end text-sm tabular-nums text-[var(--body-subtle)]">
        {count} ({pct}%)
      </span>
    </div>
  );
}

export function HBar({
  label,
  count,
  total,
  variant = "brand",
}: {
  label: string;
  count: number;
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

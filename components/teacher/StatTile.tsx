import { GlassCard } from "@/components/ui/GlassCard";

/**
 * A headline metric on a glass surface: a big tabular-numeral value with a
 * label and an optional supporting hint. Purely presentational.
 */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <GlassCard className="flex flex-col gap-1">
      <span className="text-3xl font-bold tabular-nums leading-none text-[var(--heading)]">
        {value}
      </span>
      <span className="text-sm font-medium text-[var(--body)]">{label}</span>
      {hint && <span className="text-xs text-[var(--body-subtle)]">{hint}</span>}
    </GlassCard>
  );
}

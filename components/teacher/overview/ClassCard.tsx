import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { pct, type ClassSummary } from "./aggregate";

/** One labelled metric inside a class card. */
function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-lg font-semibold tabular-nums text-[var(--heading)]">
        {value}
      </span>
      <span className="text-xs text-[var(--body-subtle)]">{label}</span>
    </div>
  );
}

/**
 * A glass card summarising one class — name, roster size, assigned-quiz count,
 * and completion-weighted average score — linking to the class analytics page.
 */
export function ClassCard({ summary }: { summary: ClassSummary }) {
  return (
    <Link
      href={`/dashboard/analytics/${summary.id}`}
      className="group block focus-visible:outline-none"
    >
      <GlassCard interactive className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 truncate text-lg font-semibold text-[var(--heading)]">
            {summary.name}
          </h3>
          <Icon name="chart" size={20} className="shrink-0 text-[var(--body)]" />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Metric label="תלמידים" value={summary.memberCount} />
          <Metric label="חידונים" value={summary.assignedCount} />
          <Metric label="ציון ממוצע" value={pct(summary.avgScore)} />
        </div>

        <span className="mt-auto text-sm font-medium text-[var(--fg-brand)]">
          צפייה באנליטיקה
        </span>
      </GlassCard>
    </Link>
  );
}

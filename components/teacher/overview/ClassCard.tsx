import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconLink } from "@/components/ui/IconButton";
import { withBackTarget } from "@/components/ui/backTarget";
import { classAnalyticsHref } from "@/components/teacher/analyticsLinks";
import type { ClassSummary } from "./aggregate";

function Metric({
  label,
  value,
  icon,
  tone = "text-[var(--body-subtle)]",
}: {
  label: string;
  value: string | number;
  icon: IconName;
  tone?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-lg font-semibold leading-none tabular-nums text-[var(--heading)]">
        <Icon name={icon} size={14} className={`flex-none ${tone}`} />
        {value}
      </span>
      <span className="text-[11px] leading-tight text-[var(--body-subtle)]">
        {label}
      </span>
    </div>
  );
}

export function ClassCard({ summary }: { summary: ClassSummary }) {
  return (
    <GlassCard interactive className="flex h-full flex-col gap-4">
      <Link
        href={withBackTarget(`/dashboard/classes/${summary.id}`, "overview")}
        aria-label={`כיתה ${summary.name}`}
        className="absolute inset-0 z-10 rounded-[inherit]"
      />
      {/* Above the stretched link, and positioned rather than in the header row:
          a z-index inside `.glass > *` would put the whole row over the card
          link and steal the click on the title. */}
      <div className="absolute top-3 end-3 z-20">
        <IconLink
          name="chart"
          label={`אנליטיקה של ${summary.name}`}
          href={withBackTarget(classAnalyticsHref(summary.id), "overview")}
          tooltipPlacement="bottom"
        />
      </div>

      <h3 className="min-w-0 truncate pe-10 text-lg font-semibold text-[var(--heading)]">
        {summary.name}
      </h3>

      <div className="mt-auto grid grid-cols-3 gap-3">
        <Metric label="תלמידים" value={summary.memberCount} icon="users" />
        <Metric
          label="חידונים פעילים"
          value={summary.activeQuizzes}
          icon="play"
          tone="text-[var(--fg-success)]"
        />
        <Metric
          label="חידונים שהסתיימו"
          value={summary.finishedQuizzes}
          icon="checkCircle"
        />
      </div>
    </GlassCard>
  );
}

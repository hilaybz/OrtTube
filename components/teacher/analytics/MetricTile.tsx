import { GlassCard } from "@/components/ui/GlassCard";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/components/ui/cn";

/**
 * A headline metric on a glass surface. Analytics owns its own tile rather than
 * borrowing the overview's, because the two answer to different designs: this
 * one always carries a stroke icon naming the dimension, and its value uses
 * PROPORTIONAL figures — `tabular-nums` gives every digit the width of a zero,
 * which makes a large standalone number like `121` read loose. Tabular figures
 * are for the table columns underneath, where digits must line up.
 */
export function MetricTile({
  label,
  value,
  hint,
  icon,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: IconName;
  className?: string;
}) {
  return (
    <GlassCard className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <span className="block text-3xl font-bold leading-none text-[var(--heading)]">
          {value}
        </span>
        <span className="mt-1.5 block text-sm font-medium text-[var(--body)]">
          {label}
        </span>
        {hint && (
          <span className="mt-0.5 block text-xs text-[var(--body-subtle)]">
            {hint}
          </span>
        )}
      </div>
      {icon && (
        <Icon name={icon} size={20} className="flex-none text-[var(--body-subtle)]" />
      )}
    </GlassCard>
  );
}

/** The stat row every analytics view opens with. */
export function MetricRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{children}</div>
  );
}

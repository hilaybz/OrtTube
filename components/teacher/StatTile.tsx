import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/components/ui/cn";

export function StatTile({
  label,
  value,
  hint,
  icon,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: IconName;
  href?: string;
}) {
  const body = (
    <GlassCard
      className={cn(
        "flex h-full flex-col gap-3",
        href &&
          "cursor-pointer transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[var(--glass-bg-hover)]"
      )}
    >
      <div className="flex items-start gap-3">
        {icon && (
          <span className="grid h-10 w-10 flex-none place-items-center rounded-[var(--radius-d)] border border-white/80 bg-white/60 text-[var(--brand)] shadow-[var(--glass-shadow)]">
            <Icon name={icon} size={18} />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-3xl font-bold leading-none tabular-nums text-[var(--heading)]">
            {value}
          </span>
          <span className="truncate text-sm font-medium text-[var(--body)]">
            {label}
          </span>
        </div>
        {href && (
          <Icon
            name="chevronLeft"
            size={16}
            className="ms-auto flex-none self-center text-[var(--gray)] transition-colors group-hover:text-[var(--fg-brand)]"
          />
        )}
      </div>
      {hint && <span className="text-xs text-[var(--body-subtle)]">{hint}</span>}
    </GlassCard>
  );

  if (!href) return body;
  return (
    // The link keeps the global `:focus-visible` ring: it is the only thing
    // that tells a keyboard user which tile they are on, and it never appears
    // for a pointer click.
    <Link href={href} className="group block h-full">
      {body}
    </Link>
  );
}

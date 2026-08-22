import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/components/ui/cn";

/**
 * A headline metric on a glass surface: a big tabular-numeral value with a
 * label and an optional supporting hint.
 *
 * `icon` and `href` are optional, so a tile given neither is a plain
 * value-and-label figure. When `href` is set the tile borrows the teacher quiz
 * card's interaction — the same lift-on-hover — so a page that mixes tiles and
 * quiz cards behaves as one family rather than two, and it grows a quiet
 * forward chevron: without it, nothing distinguishes a metric that drills into
 * a screen from one that is only a number, and the KPI row holds both.
 */
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
  /** Optional glyph, in a chip echoing the quiz card's media slot. */
  icon?: IconName;
  /** Makes the whole tile a link to the screen this metric drills into. */
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
          // Points leftward: in RTL that is "onward", the same direction the
          // pager's next control uses.
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

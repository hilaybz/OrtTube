import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/components/ui/cn";

/**
 * A headline metric on a glass surface: a big tabular-numeral value with a
 * label and an optional supporting hint.
 *
 * `icon` and `href` are optional, so a tile given neither is exactly the plain
 * value-and-label tile the analytics pages use. When `href` is set the tile
 * borrows the teacher quiz card's interaction — the same lift-on-hover — so a
 * page that mixes tiles and quiz cards behaves as one family rather than two.
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
      </div>
      {hint && <span className="text-xs text-[var(--body-subtle)]">{hint}</span>}
    </GlassCard>
  );

  if (!href) return body;
  return (
    <Link href={href} className="block h-full focus-visible:outline-none">
      {body}
    </Link>
  );
}

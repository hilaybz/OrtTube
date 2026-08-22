import Link from "next/link";
import { cn } from "./cn";
import { Icon } from "./Icon";
import { resolveBackTarget } from "./backTarget";

/**
 * The one back affordance in the product: a chevron plus the name of the
 * destination ("כל הכיתות", "החידונים שלי"), sitting at the inline-start of a
 * page header.
 *
 * `href`/`label` are the page's own default — where back goes when nothing says
 * otherwise. A page reachable from several places also passes `from`, the raw
 * `?from=` value out of its search params, and the link points at wherever the
 * user actually came from instead (see `backTarget.ts` for the registry and the
 * helper that puts the key on the outgoing link).
 *
 * Both halves are explicit on purpose. `router.back()` walks browser history, so
 * the same button led somewhere different depending on how the user arrived —
 * which is exactly what made the old back links unpredictable — and it cannot
 * name its destination. Naming it instead of "חזרה" tells the user where they
 * will land.
 *
 * The app is RTL-only, so "back" points to the inline start, i.e. right.
 */
export function BackLink({
  href,
  label,
  from,
  className,
}: {
  href: string;
  /** The destination, not the action — "כל הכיתות", not "חזרה". */
  label: string;
  /**
   * The `?from=` key the page was opened with, straight from `searchParams` (or
   * `useSearchParams().get(BACK_PARAM)` in a client component). Unrecognised or
   * absent values fall back to `href`/`label`.
   */
  from?: string | string[] | null;
  className?: string;
}) {
  const target = resolveBackTarget(from, { href, label });
  return (
    <Link
      href={target.href}
      className={cn(
        "group -ms-1.5 inline-flex w-fit items-center gap-1 rounded-[var(--radius-d)] px-1.5 py-1 text-sm font-medium text-[var(--body)] transition-colors hover:bg-[var(--neutral-quaternary)] hover:text-[var(--heading)]",
        className
      )}
    >
      <Icon
        name="chevronRight"
        size={16}
        className="flex-none transition-transform group-hover:translate-x-0.5"
      />
      {target.label}
    </Link>
  );
}

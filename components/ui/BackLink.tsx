import Link from "next/link";
import { cn } from "./cn";
import { Icon } from "./Icon";

/**
 * The one back affordance in the product: a chevron plus the name of the
 * destination ("כל הכיתות", "החידונים שלי"), sitting at the inline-start of a
 * page header.
 *
 * It takes an explicit `href` on purpose. `router.back()` walks browser history,
 * so the same button led somewhere different depending on how the user arrived —
 * which is exactly what made the old back links unpredictable. Naming the
 * destination instead of "חזרה" also tells the user where they will land.
 *
 * The app is RTL-only, so "back" points to the inline start, i.e. right.
 */
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  /** The destination, not the action — "כל הכיתות", not "חזרה". */
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
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
      {label}
    </Link>
  );
}

import { cn } from "@/components/ui/cn";

/**
 * The shared geometry of a sidebar row, so the nav links and the pinned
 * sign-out control cannot drift apart. `collapsed` only bites from `md` up —
 * the mobile drawer is always the full-width, labelled version.
 */
export function navRowClass({
  active = false,
  collapsed = false,
  danger = false,
}: {
  active?: boolean;
  collapsed?: boolean;
  danger?: boolean;
} = {}): string {
  return cn(
    "flex w-full items-center gap-3 rounded-full px-4 py-3 text-sm font-medium transition-colors",
    collapsed && "md:justify-center md:gap-0 md:px-0",
    active
      ? "bg-white/85 font-semibold text-[var(--fg-brand)] shadow-[var(--glass-shadow)]"
      : danger
        ? "text-[var(--body)] hover:bg-[var(--danger-soft)] hover:text-[var(--fg-danger)]"
        : "text-[var(--body)] hover:bg-white/60 hover:text-[var(--heading)]"
  );
}

/**
 * Label visibility inside a row: hidden from sight on a collapsed rail but kept
 * in the accessibility tree, so the link keeps its accessible name without a
 * duplicating `aria-label`.
 */
export function navLabelClass(collapsed: boolean): string {
  return cn("truncate", collapsed && "md:sr-only");
}

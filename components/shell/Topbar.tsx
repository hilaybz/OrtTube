"use client";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/Icon";

/**
 * Top chrome: the mobile drawer trigger plus a content slot (search/filters) and
 * an optional trailing slot. Deliberately thin — account actions (sign-out) live
 * at the bottom of the sidebar, not here.
 */
export function Topbar({
  onMenu,
  children,
  right,
  className,
}: {
  onMenu?: () => void;
  children?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-center gap-3 px-6 py-4", className)}>
      <button
        type="button"
        onClick={onMenu}
        aria-label="תפריט"
        className="rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2.5 md:hidden"
      >
        <Icon name="menu" size={18} />
      </button>
      <div className="flex flex-1 items-center gap-3">{children}</div>
      <div className="flex items-center gap-2">{right}</div>
    </header>
  );
}

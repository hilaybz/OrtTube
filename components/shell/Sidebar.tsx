"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { CountBadge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";
import { navLabelClass, navRowClass } from "./navRow";
import { SignOutButton } from "./SignOutButton";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  count?: number;
}

/**
 * The single active nav href for a path: the longest item href that equals the
 * path or is a parent segment of it. Picking the longest match means a nested
 * route (`/dashboard/classes`) activates "כיתות", not the "/dashboard" index.
 */
function activeHrefFor(
  pathname: string,
  hrefs: ReadonlyArray<string>
): string | undefined {
  return hrefs
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0];
}

/**
 * Role-agnostic app navigation: the brand lockup, the nav rows, and sign-out
 * pinned to the bottom. `collapsed` shrinks it to an icon rail from `md` up
 * (labels stay in the accessibility tree, tooltips stand in visually); the
 * mobile drawer ignores it and is always the labelled, full-width version.
 */
export function Sidebar({
  items,
  brand,
  open = false,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: {
  items: ReadonlyArray<NavItem>;
  brand: string;
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname() ?? "";
  const activeHref = activeHrefFor(
    pathname,
    items.map((i) => i.href)
  );
  return (
    <>
      {/* mobile scrim */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "z-40 flex w-64 flex-none flex-col gap-1 border-e border-white/60 bg-white/35 p-4 backdrop-blur-[24px] md:transition-[width] md:duration-200",
          collapsed && "md:w-[5.25rem]",
          // Mobile: fixed drawer anchored to the right (inline-start in RTL).
          "max-md:fixed max-md:inset-y-0 max-md:start-0 max-md:transition-transform",
          open ? "max-md:translate-x-0" : "max-md:translate-x-full",
          "md:translate-x-0"
        )}
      >
        <div
          className={cn(
            "flex items-center gap-3 px-2 pb-4 pt-1",
            collapsed && "md:flex-col md:gap-2 md:px-0"
          )}
        >
          <span className="grid h-11 w-11 flex-none place-items-center rounded-[14px] border border-white/80 bg-white/60 shadow-[var(--glass-shadow)]">
            <Icon name="play" size={20} className="text-[var(--brand)]" />
          </span>
          <span
            className={cn(
              "truncate text-lg font-bold tracking-wide",
              collapsed && "md:hidden"
            )}
          >
            {brand}
          </span>
          {onToggleCollapse && (
            <div className={cn("ms-auto max-md:hidden", collapsed && "md:ms-0")}>
              <IconButton
                name="sidebar"
                label={collapsed ? "הרחבת סרגל הניווט" : "כיווץ סרגל הניווט"}
                aria-expanded={!collapsed}
                onClick={onToggleCollapse}
                tooltipPlacement="bottom"
              />
            </div>
          )}
        </div>

        <nav className="flex flex-col gap-1">
          {items.map((item) => {
            const active = item.href === activeHref;
            const row = (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={navRowClass({ active, collapsed })}
              >
                <Icon name={item.icon} size={20} className="flex-none" />
                <span className={navLabelClass(collapsed)}>{item.label}</span>
                {item.count && !collapsed ? (
                  <CountBadge count={item.count} />
                ) : null}
              </Link>
            );
            return collapsed ? (
              <Tooltip key={item.href} content={item.label} className="w-full">
                {row}
              </Tooltip>
            ) : (
              row
            );
          })}
        </nav>

        <div className="mt-auto pt-4">
          <SignOutButton collapsed={collapsed} />
        </div>
      </aside>
    </>
  );
}

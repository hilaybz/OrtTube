"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { Icon, type IconName } from "@/components/ui/Icon";
import { CountBadge } from "@/components/ui/Badge";

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

export function Sidebar({
  items,
  brand,
  open = false,
  onClose,
}: {
  items: ReadonlyArray<NavItem>;
  brand: string;
  open?: boolean;
  onClose?: () => void;
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
          "z-40 flex w-64 flex-none flex-col gap-1 border-s border-white/60 bg-white/35 p-4 backdrop-blur-[24px]",
          "max-md:fixed max-md:inset-y-0 max-md:end-0 max-md:transition-transform",
          open ? "max-md:translate-x-0" : "max-md:translate-x-full",
          "md:translate-x-0"
        )}
      >
        <div className="flex items-center gap-3 px-2 pb-4 pt-1">
          <span className="grid h-11 w-11 place-items-center rounded-[14px] border border-white/80 bg-white/60 shadow-[var(--glass-shadow)]">
            <Icon name="play" size={20} className="text-[var(--brand)]" />
          </span>
          <span className="text-lg font-bold tracking-wide">{brand}</span>
        </div>
        <nav className="flex flex-col gap-1">
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-full px-4 py-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-white/85 font-semibold text-[var(--fg-brand)] shadow-[var(--glass-shadow)]"
                    : "text-[var(--body)] hover:bg-white/60 hover:text-[var(--heading)]"
                )}
              >
                <Icon name={item.icon} size={20} />
                <span>{item.label}</span>
                {item.count ? <CountBadge count={item.count} /> : null}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

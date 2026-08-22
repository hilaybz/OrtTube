"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { Icon, type IconName } from "@/components/ui/Icon";
import { CountBadge } from "@/components/ui/Badge";
import { navLabelClass, navRowClass } from "./navRow";
import { SignOutButton } from "./SignOutButton";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  count?: number;
}

/**
 * The rail's resting width from `md` up — icon-only. Exported so the spacer
 * `AppShell` keeps in the flow cannot drift from the rail it stands in for.
 *
 * Tailwind only generates classes it can see written out in full, so the `md:`
 * variant is a literal rather than `md:${RAIL_WIDTH_CLASS}` and has to stay in
 * step with it.
 */
export const RAIL_WIDTH_CLASS = "w-[5.25rem]";
const RAIL_WIDTH_MD = "md:w-[5.25rem]";

/** The labelled width: the mobile drawer, and the rail while it is open. */
const OPEN_WIDTH_CLASS = "w-64";

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
 * pinned to the bottom.
 *
 * From `md` up the rail rests at icon width and opens to its labelled width
 * while the pointer is over it or focus is inside it. It is `fixed`, so opening
 * floats it *above* the page instead of reflowing the main column, and the page
 * scrolling underneath cannot move it. Focus keeps it open on its own so a
 * keyboard user can tab from the brand down to sign-out without the labels
 * disappearing under them.
 *
 * Its own content scrolls independently (`overflow-y-auto` on the inner column,
 * `overscroll-contain` so a rail-local scroll never chains out to the page), and
 * only when a long nav genuinely overflows the viewport — sign-out is always
 * reachable without scrolling the page.
 *
 * The mobile drawer (hamburger + scrim) ignores all of that: it is always the
 * labelled, full-width version, and `open` slides it in.
 */
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
  // Hover and focus are tracked apart so that neither can cancel the other: a
  // keyboard user who tabs into the rail keeps it open after the pointer has
  // long left, and a pointer user keeps it open while focus sits elsewhere.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // `expanded` only ever describes the `md`-and-up rail; the drawer below `md`
  // is labelled regardless, which is why every class it drives is `md:`-scoped.
  const expanded = hovered || focused;

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
        data-expanded={expanded || undefined}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          // React's blur bubbles (it is `focusout`), so moving between two rows
          // inside the rail fires it too. Only a focus that landed outside the
          // rail closes it.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setFocused(false);
          }
        }}
        className={cn(
          "fixed inset-y-0 start-0 z-40 flex flex-col border-e border-white/60 bg-white/35 backdrop-blur-[24px]",
          // Mobile: a drawer that slides in from the inline start (the right).
          OPEN_WIDTH_CLASS,
          "max-md:transition-transform",
          open ? "max-md:translate-x-0" : "max-md:translate-x-full",
          "md:translate-x-0",
          // From `md` up: an icon rail that grows over the page content. Only
          // the narrow width is a `md:` class — with no `tailwind-merge` here,
          // two competing width utilities would be settled by stylesheet order
          // rather than by this expression, so expanding simply drops back to
          // the base labelled width.
          !expanded && RAIL_WIDTH_MD,
          "md:transition-[width] md:duration-200"
        )}
      >
        {/* The rail's own scroll container: full height, independent of the
            page, and only scrollable when the nav really is taller than the
            viewport. */}
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-4">
          <div
            className={cn(
              "flex items-center gap-3 px-2 pb-4 pt-1",
              !expanded && "md:justify-center md:px-0"
            )}
          >
            <span className="grid h-11 w-11 flex-none place-items-center rounded-[14px] border border-white/80 bg-white/60 shadow-[var(--glass-shadow)]">
              <Icon name="play" size={20} className="text-[var(--brand)]" />
            </span>
            <span
              className={cn(
                "truncate text-lg font-bold tracking-wide",
                !expanded && "md:hidden"
              )}
            >
              {brand}
            </span>
          </div>

          <nav className="flex flex-col gap-1">
            {items.map((item) => {
              const active = item.href === activeHref;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={navRowClass({ active, collapsed: !expanded })}
                >
                  <Icon name={item.icon} size={20} className="flex-none" />
                  <span className={navLabelClass(!expanded)}>{item.label}</span>
                  {/* No room for a count on the resting rail — hidden with the
                      labels, and always shown in the mobile drawer. */}
                  {item.count ? (
                    <span className={cn("ms-auto inline-flex", !expanded && "md:hidden")}>
                      <CountBadge count={item.count} />
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto pt-4">
            <SignOutButton collapsed={!expanded} />
          </div>
        </div>
      </aside>
    </>
  );
}

"use client";
import { useState, useSyncExternalStore } from "react";
import { Sidebar, type NavItem } from "./Sidebar";
import { Topbar } from "./Topbar";
import {
  getSidebarCollapsed,
  setSidebarCollapsed,
  subscribeSidebarCollapsed,
} from "./sidebarCollapse";

/**
 * Role app chrome: glass sidebar (inline-end / right in RTL) + main column with
 * a Topbar and a scrollable content area. Server layouts pass a serializable
 * `nav` and the server-rendered page as `children`.
 *
 * The sidebar's collapsed state lives in a cookie (see `sidebarCollapse.ts`), so
 * it persists across navigations and reloads. `initialCollapsed` is the value
 * the layout read server-side; it is the hydration snapshot, which is what keeps
 * a collapsed rail from flashing open on first paint. A layout that omits it
 * still gets a working, persisted toggle — just a one-frame correction after
 * hydration.
 */
export function AppShell({
  nav,
  brand = "OrtTube",
  topbar,
  initialCollapsed = false,
  children,
}: {
  nav: ReadonlyArray<NavItem>;
  brand?: string;
  topbar?: React.ReactNode;
  initialCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarCollapsed,
    () => initialCollapsed
  );
  return (
    <div className="flex min-h-screen">
      {/* Sidebar first → inline-start → the RIGHT in this RTL app. */}
      <Sidebar
        items={nav}
        brand={brand}
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setSidebarCollapsed(!collapsed)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)}>{topbar}</Topbar>
        <div className="flex-1 overflow-y-auto px-6 pb-8">{children}</div>
      </main>
    </div>
  );
}

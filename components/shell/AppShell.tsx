"use client";
import { useState } from "react";
import { Sidebar, type NavItem } from "./Sidebar";
import { Topbar } from "./Topbar";
import { SignOutButton } from "./SignOutButton";

/**
 * Role app chrome: glass sidebar (inline-end / right in RTL) + main column with
 * a Topbar and a scrollable content area. Server layouts pass a serializable
 * `nav` and the server-rendered page as `children`.
 */
export function AppShell({
  nav,
  brand = "OrtTube",
  topbar,
  children,
}: {
  nav: ReadonlyArray<NavItem>;
  brand?: string;
  topbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <main className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} right={<SignOutButton />}>
          {topbar}
        </Topbar>
        <div className="flex-1 overflow-y-auto px-6 pb-8">{children}</div>
      </main>
      <Sidebar
        items={nav}
        brand={brand}
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
    </div>
  );
}

"use client";
import { useState } from "react";
import { cn } from "@/components/ui/cn";
import { Sidebar, RAIL_WIDTH_CLASS, type NavItem } from "./Sidebar";
import { Topbar } from "./Topbar";

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
      <Sidebar
        items={nav}
        brand={brand}
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
      {/* Holds the icon rail's width open in the flow. The rail itself is taken
          out of the flow (fixed) so that expanding it cannot reflow the page. */}
      <div className={cn("hidden flex-none md:block", RAIL_WIDTH_CLASS)} aria-hidden="true" />
      <main className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)}>{topbar}</Topbar>
        <div className="flex-1 overflow-y-auto px-6 pb-8">{children}</div>
      </main>
    </div>
  );
}

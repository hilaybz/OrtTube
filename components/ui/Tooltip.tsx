"use client";
import { useState } from "react";
import { cn } from "./cn";

/**
 * Dark tooltip (per tooltips-popovers.md). Shows on hover + focus, and hides on
 * Escape so a keyboard user can dismiss it. `placement` flips the bubble below
 * the trigger for controls that sit at the very top of a scroll container,
 * where a bubble above would be clipped. The bubble never takes pointer events,
 * so it cannot swallow a click meant for the trigger.
 */
export function Tooltip({
  content,
  placement = "top",
  children,
  className,
}: {
  content: string;
  placement?: "top" | "bottom";
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute start-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-d)] bg-[var(--heading)] px-3 py-2 text-xs font-medium text-white shadow-[var(--shadow-xs)] rtl:translate-x-1/2",
            placement === "top" ? "bottom-full mb-2" : "top-full mt-2"
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}

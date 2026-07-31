"use client";
import { useState } from "react";
import { cn } from "./cn";

/** Dark tooltip (per tooltips-popovers.md). Shows on hover + focus. */
export function Tooltip({
  content,
  children,
  className,
}: {
  content: string;
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
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full start-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-d)] bg-[var(--heading)] px-3 py-2 text-xs font-medium text-white shadow-[var(--shadow-xs)] rtl:translate-x-1/2"
        >
          {content}
        </span>
      )}
    </span>
  );
}

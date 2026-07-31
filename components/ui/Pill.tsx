"use client";
import { cn } from "./cn";

/** A rounded-full toggle chip. `active` → solid brand; else glass. */
export function Pill({
  active = false,
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        "rounded-full px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-[var(--brand)] text-white shadow-[0_4px_14px_rgba(14,166,109,0.35)]"
          : "border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--body)] hover:bg-[var(--glass-bg-hover)]",
        className
      )}
      {...props}
    />
  );
}

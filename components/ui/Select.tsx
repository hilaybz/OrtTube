"use client";
import { useId } from "react";
import { cn } from "./cn";

/** Labelled native select styled as a glass input. */
export function Select({
  label,
  name,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  name: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-[var(--heading)]">
        {label}
      </label>
      <select
        id={id}
        name={name}
        className={cn(
          "rounded-[var(--radius)] bg-[var(--glass-bg)] px-3 py-2.5 text-sm text-[var(--heading)]",
          "border border-[var(--glass-border)] outline-none backdrop-blur-[20px] transition-colors",
          "focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]",
          className
        )}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

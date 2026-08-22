"use client";
import { useId } from "react";
import { cn } from "./cn";

/**
 * Labelled native select styled as a glass input.
 *
 * Like `Field`, it declares no focused look of its own: the quiet, keyboard-
 * first focus treatment for every text-entry control lives in `app/globals.css`,
 * because a browser matches `:focus-visible` on a select the user merely
 * clicked — which is how a brand ring became a green box around a dropdown.
 */
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
          "border border-[var(--glass-border)] backdrop-blur-[20px] transition-colors",
          className
        )}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

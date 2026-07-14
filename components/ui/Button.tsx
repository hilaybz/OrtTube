"use client";
import { cn } from "./cn";

type Variant = "brand" | "secondary" | "tertiary" | "ghost" | "danger";
type Size = "sm" | "base" | "lg";

const SIZE: Record<Size, string> = {
  sm: "text-sm px-3 py-2",
  base: "text-sm px-4 py-2.5",
  lg: "text-base px-5 py-3",
};

// The design system's "glint": base shadow + inset top-edge highlight + soft glow.
const glint =
  "shadow-[var(--shadow-xs),inset_var(--color-1-400)_0_6px_0px_-5px,var(--color-1-700)_0_4px_10px_-5px]";

const VARIANT: Record<Variant, string> = {
  // ink text on mint — white-on-mint fails WCAG in this palette.
  brand: `bg-[var(--brand)] text-[#06210f] border border-transparent hover:bg-[var(--brand-strong)] ${glint}`,
  secondary: `bg-[var(--neutral-quaternary)] text-[var(--body)] border border-[var(--border-default-medium)] hover:text-[var(--heading)] ${glint}`,
  tertiary: `bg-[var(--neutral-primary-soft)] text-[var(--body)] border border-[var(--border-default)] hover:bg-[var(--neutral-quaternary)] ${glint}`,
  danger: `bg-[var(--fg-danger)] text-white border border-transparent ${glint}`,
  ghost:
    "bg-transparent text-[var(--heading)] border border-transparent hover:bg-[var(--neutral-quaternary)]",
};

export function Button({
  variant = "brand",
  size = "base",
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:bg-[var(--neutral-tertiary)] disabled:text-[var(--body-subtle)] disabled:shadow-none disabled:border-[var(--border-default-medium)]",
        SIZE[size],
        VARIANT[variant],
        className
      )}
      {...props}
    />
  );
}

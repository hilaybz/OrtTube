"use client";
import Link from "next/link";
import { cn } from "./cn";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";

type Variant = "neutral" | "brand" | "danger";
type Size = "sm" | "base" | "lg";

const SIZE: Record<Size, { box: string; icon: number }> = {
  sm: { box: "h-8 w-8", icon: 16 },
  base: { box: "h-9 w-9", icon: 18 },
  lg: { box: "h-11 w-11", icon: 22 },
};

const VARIANT: Record<Variant, string> = {
  // Quiet by default — icon actions sit inside rows and cards, so they only
  // gain a surface on hover.
  neutral:
    "text-[var(--body)] hover:bg-[var(--neutral-quaternary)] hover:text-[var(--heading)]",
  // The one affirmative icon action per screen (add, assign) reads as a button:
  // ink on mint, matching `Button variant="brand"` (white on mint fails WCAG).
  brand:
    "bg-[var(--brand)] text-[#06210f] hover:bg-[var(--brand-strong)] shadow-[var(--shadow-xs)]",
  danger: "text-[var(--fg-danger)] hover:bg-[var(--danger-soft)]",
};

const base =
  "inline-flex flex-none items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent";

/**
 * Icon-only button. `label` is both the `aria-label` and the hover/focus
 * tooltip, so an icon action is never unlabelled: this is the component the
 * "obvious actions become icons" rule leans on (delete, edit, assign, close,
 * send, clear filters).
 *
 * `busy` swaps the glyph for a spinner and disables the button, so a pending
 * mutation cannot be fired twice. Destructive actions keep their confirmation
 * dialog — `variant="danger"` only changes the colour.
 */
export function IconButton({
  name,
  label,
  variant = "neutral",
  size = "base",
  busy = false,
  disabled,
  tooltipPlacement = "top",
  className,
  type = "button",
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  name: IconName;
  /** Accessible name and tooltip text — required; an icon alone says nothing. */
  label: string;
  variant?: Variant;
  size?: Size;
  busy?: boolean;
  /** Preferred tooltip side; the bubble flips and clamps itself when it must. */
  tooltipPlacement?: "top" | "bottom";
}) {
  const { box, icon } = SIZE[size];
  return (
    <Tooltip content={label} placement={tooltipPlacement}>
      <button
        type={type}
        aria-label={label}
        aria-busy={busy || undefined}
        disabled={disabled || busy}
        className={cn(base, box, VARIANT[variant], className)}
        {...props}
      >
        {busy ? <Spinner size={icon} label={label} /> : <Icon name={name} size={icon} />}
      </button>
    </Tooltip>
  );
}

/**
 * The navigation twin of `IconButton` — same look and labelling, but it renders
 * a link. Use it when the action is "go somewhere" (open analytics, open a
 * class); use `IconButton` when it mutates something.
 */
export function IconLink({
  name,
  label,
  href,
  variant = "neutral",
  size = "base",
  tooltipPlacement = "top",
  className,
  ...props
}: Omit<React.ComponentProps<typeof Link>, "children" | "aria-label" | "href"> & {
  name: IconName;
  label: string;
  href: string;
  variant?: Variant;
  size?: Size;
  /** Preferred tooltip side; the bubble flips and clamps itself when it must. */
  tooltipPlacement?: "top" | "bottom";
}) {
  const { box, icon } = SIZE[size];
  return (
    <Tooltip content={label} placement={tooltipPlacement}>
      <Link
        href={href}
        aria-label={label}
        className={cn(base, box, VARIANT[variant], className)}
        {...props}
      >
        <Icon name={name} size={icon} />
      </Link>
    </Tooltip>
  );
}

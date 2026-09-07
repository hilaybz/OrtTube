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
  neutral:
    "text-[var(--body)] hover:bg-[var(--neutral-quaternary)] hover:text-[var(--heading)]",
  brand:
    "bg-[var(--brand)] text-[#06210f] hover:bg-[var(--brand-strong)] shadow-[var(--shadow-xs)]",
  danger: "text-[var(--fg-danger)] hover:bg-[var(--danger-soft)]",
};

const base =
  "inline-flex flex-none items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent";

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
  label: string;
  variant?: Variant;
  size?: Size;
  busy?: boolean;
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

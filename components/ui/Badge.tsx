import { cn } from "./cn";

type Variant = "brand" | "gray" | "success" | "danger" | "warning";

const VARIANT: Record<Variant, string> = {
  brand: "bg-[var(--brand-softer)] text-[var(--fg-brand-strong)] border-[var(--brand-soft)]",
  gray: "bg-[var(--neutral-secondary-soft)] text-[var(--heading)] border-[var(--border-default)]",
  success: "bg-[var(--success-soft)] text-[var(--fg-success)] border-[var(--success-soft)]",
  danger: "bg-[var(--danger-soft)] text-[var(--fg-danger)] border-[var(--danger-soft)]",
  warning: "bg-[var(--warning-soft)] text-[var(--fg-warning)] border-[var(--warning-soft)]",
};

export function Badge({
  variant = "gray",
  pill = false,
  className,
  children,
}: {
  variant?: Variant;
  pill?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border px-2 py-0.5 text-xs font-medium",
        pill ? "rounded-full" : "rounded-[var(--radius-d)]",
        VARIANT[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

/** Small red notification count for nav items. */
export function CountBadge({ count }: { count: number }) {
  return (
    <span className="ms-auto inline-flex min-w-[20px] items-center justify-center rounded-full bg-[var(--fg-danger)] px-2 py-0.5 text-[11px] font-semibold text-white">
      {count}
    </span>
  );
}

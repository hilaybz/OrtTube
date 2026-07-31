import { cn } from "./cn";

type Variant = "brand" | "success" | "danger" | "warning";

const VARIANT: Record<Variant, string> = {
  brand: "bg-[var(--brand-softer)] text-[var(--fg-brand-strong)] border-[var(--brand-soft)]",
  success: "bg-[var(--success-soft)] text-[var(--fg-success)] border-[var(--success-soft)]",
  danger: "bg-[var(--danger-soft)] text-[var(--fg-danger)] border-[var(--danger-soft)]",
  warning: "bg-[var(--warning-soft)] text-[var(--fg-warning)] border-[var(--warning-soft)]",
};

/** Inline status message. danger/warning get `role="alert"` for assertive SR. */
export function Alert({
  variant = "brand",
  title,
  className,
  children,
}: {
  variant?: Variant;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const assertive = variant === "danger" || variant === "warning";
  return (
    <div
      role={assertive ? "alert" : "status"}
      className={cn(
        "rounded-[var(--radius)] border p-4 text-sm",
        VARIANT[variant],
        className
      )}
    >
      {title && <p className="mb-1 font-medium">{title}</p>}
      {children}
    </div>
  );
}

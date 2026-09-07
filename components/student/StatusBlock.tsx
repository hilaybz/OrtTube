import { cn } from "@/components/ui/cn";
import { Icon, type IconName } from "@/components/ui/Icon";

export type StatusTone = "success" | "danger" | "warning" | "brand" | "neutral";

const TONE: Record<StatusTone, string> = {
  success: "border-[var(--success-soft)] bg-[var(--success-soft)] text-[var(--fg-success)]",
  danger: "border-[var(--danger-soft)] bg-[var(--danger-soft)] text-[var(--fg-danger)]",
  warning: "border-[var(--warning-soft)] bg-[var(--warning-soft)] text-[var(--fg-warning)]",
  brand: "border-[var(--brand-soft)] bg-[var(--brand-softer)] text-[var(--fg-brand-strong)]",
  neutral: "border-[var(--glass-border)] bg-white/50 text-[var(--body)]",
};

export function StatusBlock({
  icon,
  tone = "neutral",
  headline,
  meta,
  strong = false,
  className,
}: {
  icon: IconName;
  tone?: StatusTone;
  headline: React.ReactNode;
  strong?: boolean;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[var(--radius-d)] border p-3",
        TONE[tone],
        className
      )}
    >
      <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-white/70">
        <Icon name={icon} size={18} />
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block leading-snug",
            strong ? "text-base font-bold" : "text-sm font-semibold"
          )}
        >
          {headline}
        </span>
        {meta && <span className="block text-xs opacity-80">{meta}</span>}
      </span>
    </div>
  );
}

"use client";
import { useRef } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./Icon";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

/**
 * Underline tabs (per tabs.md). Controlled: `value` + `onChange`. Panels are
 * owned by the caller. Roving arrow-key navigation across the tablist.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  ariaLabel,
}: {
  tabs: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const dir = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0; // RTL: Left = next
    if (!dir) return;
    e.preventDefault();
    const next = (index + dir + tabs.length) % tabs.length;
    refs.current[next]?.focus();
    onChange(tabs[next].value);
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex gap-6 border-b border-[var(--glass-border)]",
        className
      )}
    >
      {tabs.map((t, i) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-0.5 py-3 text-sm font-medium transition-colors",
              active
                ? "border-[var(--brand)] font-semibold text-[var(--fg-brand)]"
                : "border-transparent text-[var(--body)] hover:text-[var(--heading)]"
            )}
          >
            {t.icon && <Icon name={t.icon} size={18} />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

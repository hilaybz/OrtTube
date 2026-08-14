"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon";
import { cn } from "./cn";

export interface MultiSelectOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A labelled, glass-styled trigger that opens a checkbox panel — the
 * multi-select counterpart to `Select` (which is native/single-value). Used
 * wherever a `Pill` row would otherwise wrap into several lines once the
 * option list grows (e.g. a school's full class roster) — one compact
 * control instead of an unbounded row of chips.
 */
export function MultiSelectDropdown<T extends string>({
  label,
  options,
  selected,
  onChange,
  emptyLabel = "הכל",
  className,
}: {
  label: string;
  options: MultiSelectOption<T>[];
  selected: Set<T>;
  onChange: (next: Set<T>) => void;
  /** Trigger text when nothing is selected. */
  emptyLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const labelId = `${id}-label`;

  // Close on an outside click or Escape — same pattern as
  // CheckpointTimeline's cluster popover.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle(value: T) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  const summary =
    selected.size === 0
      ? emptyLabel
      : selected.size === 1
        ? (options.find((o) => selected.has(o.value))?.label ?? emptyLabel)
        : `${selected.size} נבחרו`;

  return (
    <div ref={rootRef} className={cn("relative flex flex-col gap-2", className)}>
      <span id={labelId} className="text-sm font-medium text-[var(--heading)]">
        {label}
      </span>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-labelledby={labelId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex min-w-[10rem] items-center justify-between gap-2 rounded-[var(--radius)] bg-[var(--glass-bg)] px-3 py-2.5 text-sm text-[var(--heading)]",
          "border border-[var(--glass-border)] outline-none backdrop-blur-[20px] transition-colors",
          "focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
        )}
      >
        <span className="truncate">{summary}</span>
        <Icon
          name="chevron"
          size={16}
          className={cn("flex-none transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div
          aria-labelledby={labelId}
          className="absolute top-full z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-[var(--radius-d)] border border-[var(--glass-border)] bg-white p-1 shadow-[var(--shadow-md)]"
        >
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm text-[var(--body)] hover:bg-[var(--neutral-quaternary)]"
            >
              <input
                type="checkbox"
                checked={selected.has(o.value)}
                onChange={() => toggle(o.value)}
                className="h-4 w-4 flex-none rounded-[var(--radius-sm)] border border-[var(--glass-border)] accent-[var(--brand)]"
              />
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

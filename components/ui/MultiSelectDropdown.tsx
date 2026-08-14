"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { cn } from "./cn";

export interface MultiSelectOption<T extends string> {
  value: T;
  label: string;
}

const PANEL_WIDTH = 224; // px — matches the panel's own w-56.

/**
 * A labelled, glass-styled trigger that opens a checkbox panel — the
 * multi-select counterpart to `Select` (which is native/single-value). Used
 * wherever a `Pill` row would otherwise wrap into several lines once the
 * option list grows (e.g. a school's full class roster) — one compact
 * control instead of an unbounded row of chips. The option list itself caps
 * at `max-h-64` with internal scroll, so a long roster scrolls rather than
 * growing the panel unboundedly.
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
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const labelId = `${id}-label`;

  // The filter bar sits inside a `.glass` card, which sets `overflow: hidden`
  // for its own blur/edge-highlight effect — an absolutely-positioned panel
  // nested inside it gets clipped at the card's edge. Portal the open panel to
  // <body> instead, positioned with fixed VIEWPORT coordinates read off the
  // trigger's own rect, so it floats above everything and is clipped by
  // nothing. Repositions (not closes) on scroll/resize so it stays anchored;
  // "closes on scroll" would also fire while scrolling the panel's own
  // internal option list, which is exactly the wrong behaviour here.
  useEffect(() => {
    if (!open) return;
    function place() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const overflowsRight = rect.left + PANEL_WIDTH > window.innerWidth - 8;
      setPanelStyle(
        overflowsRight
          ? {
              position: "fixed",
              top: rect.bottom + 4,
              right: window.innerWidth - rect.right,
              width: PANEL_WIDTH,
            }
          : { position: "fixed", top: rect.bottom + 4, left: rect.left, width: PANEL_WIDTH }
      );
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Close on an outside click or Escape — same pattern as CheckpointTimeline's
  // cluster popover. "Outside" excludes the portaled panel itself, which sits
  // outside the trigger's own DOM subtree once portaled to <body>.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      const insideTrigger = triggerRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel) setOpen(false);
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
    <div className={cn("flex flex-col gap-2", className)}>
      <span id={labelId} className="text-sm font-medium text-[var(--heading)]">
        {label}
      </span>
      <button
        ref={triggerRef}
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
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            aria-labelledby={labelId}
            style={panelStyle}
            className="z-50 max-h-64 w-56 overflow-y-auto rounded-[var(--radius-d)] border border-[var(--glass-border)] bg-white p-1 shadow-[var(--shadow-md)]"
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
          </div>,
          document.body
        )}
    </div>
  );
}

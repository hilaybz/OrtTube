"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { cn } from "./cn";

export interface MultiSelectOption<T extends string> {
  value: T;
  label: string;
}

/** Smallest gap the panel keeps from a viewport edge. */
const EDGE = 8;

/**
 * A labelled, glass-styled trigger that opens a checkbox panel — the
 * multi-select counterpart to `Select` (which is native/single-value). Used
 * wherever a `Pill` row would otherwise wrap into several lines once the
 * option list grows (e.g. a school's full class roster) — one compact
 * control instead of an unbounded row of chips. The option list itself caps
 * at `max-h-64` with internal scroll, so a long roster scrolls rather than
 * growing the panel unboundedly.
 *
 * The panel is as wide as its own longest option label (between a min and a max)
 * rather than a fixed width, so a filter over short class names is a short
 * dropdown instead of a slab far wider than anything in it.
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
  // Null until the open panel has been measured once — see the layout effect.
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const labelId = `${id}-label`;

  // Closing forgets the measured position, so the next open measures afresh
  // instead of flashing at wherever the trigger used to be.
  const close = useCallback(() => {
    setOpen(false);
    setPanelStyle(null);
  }, []);

  // The filter bar sits inside a `.glass` card, which sets `overflow: hidden`
  // for its own blur/edge-highlight effect — an absolutely-positioned panel
  // nested inside it gets clipped at the card's edge. Portal the open panel to
  // <body> instead, positioned with fixed VIEWPORT coordinates read off the
  // trigger's own rect, so it floats above everything and is clipped by
  // nothing. Repositions (not closes) on scroll/resize so it stays anchored;
  // "closes on scroll" would also fire while scrolling the panel's own
  // internal option list, which is exactly the wrong behaviour here.
  //
  // useLayoutEffect (not useEffect): `panelStyle` is null until measured, and on
  // the FIRST open of an instance a plain effect wouldn't compute real
  // coordinates until after the browser had already painted the portaled div
  // at its default flow position (the very bottom of <body>) for one frame.
  // On a second open, it would paint at whatever stale position was left
  // over from the previous close. Running synchronously before paint avoids
  // both — the unmeasured frame is laid out (so it can be measured) but
  // hidden.
  //
  // The panel's WIDTH is the browser's business, not a constant: the panel is
  // `w-max` between a min and a max, so it ends up as wide as its longest
  // option label plus the row padding — a class filter listing "ז׳1" no longer
  // gets the same slab of width as one listing a long course name. That is why
  // the panel is measured here rather than positioned from a known width.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!rect || !panel) return;
      const width = panel.offsetWidth;
      // RTL: anchor the panel's inline start (its right edge) to the trigger's,
      // then clamp so a wide panel slides inward instead of off-screen.
      const anchored = rect.right - width;
      const left = Math.min(
        Math.max(EDGE, anchored),
        Math.max(EDGE, window.innerWidth - width - EDGE)
      );
      setPanelStyle({ position: "fixed", top: rect.bottom + 4, left });
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
      if (!insideTrigger && !insidePanel) close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

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
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          "flex min-w-[10rem] items-center justify-between gap-2 rounded-[var(--radius)] bg-[var(--glass-bg)] px-3 py-2.5 text-sm text-[var(--heading)]",
          // No focus ring of its own: this is a button, so the app-wide
          // keyboard-only `:focus-visible` outline already covers it, and a
          // brand ring here painted a green box on a plain click.
          "border border-[var(--glass-border)] backdrop-blur-[20px] transition-colors"
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
            style={
              panelStyle ?? {
                // First frame: laid out for measurement, not yet painted.
                position: "fixed",
                top: 0,
                left: 0,
                visibility: "hidden",
              }
            }
            className="z-50 max-h-64 w-max min-w-[10rem] max-w-[min(22rem,calc(100vw-1rem))] overflow-y-auto rounded-[var(--radius-d)] border border-[var(--glass-border)] bg-white p-1 shadow-[var(--shadow-md)] [scrollbar-gutter:stable]"
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

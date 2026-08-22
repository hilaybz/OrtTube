"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

/** Distance between the trigger and the bubble. */
const GAP = 8;
/** Smallest gap the bubble keeps from any viewport edge. */
const EDGE = 8;

/** Where the bubble ended up — the caller's `placement` is only a preference. */
type Side = "top" | "bottom";

/**
 * How the user last interacted with the page, shared by every tooltip on it.
 *
 * A tooltip is an aid for someone who cannot see a label, so it belongs to
 * keyboard navigation — and `focus` alone cannot tell the two apart. A click
 * focuses the button it pressed, and dismissing a dialog restores focus to the
 * control that opened it, so opening on any focus is how a bubble came back by
 * itself after a confirmation dialog was cancelled. Browsers make the same
 * distinction for `:focus-visible`; jsdom does not implement it, so the
 * modality is tracked here rather than queried from the element.
 */
let lastModality: "pointer" | "keyboard" = "pointer";
let trackingModality = false;

function trackModality(): void {
  if (trackingModality || typeof document === "undefined") return;
  trackingModality = true;
  document.addEventListener("pointerdown", () => (lastModality = "pointer"), true);
  document.addEventListener("keydown", () => (lastModality = "keyboard"), true);
}

interface Position {
  top: number;
  left: number;
}

/**
 * Dark tooltip (per tooltips-popovers.md). Shows on hover and on *keyboard*
 * focus, and never outlives the interaction that opened it.
 *
 * The bubble is portaled to `<body>` with fixed viewport coordinates read off
 * the trigger's own rect, exactly like `MultiSelectDropdown`'s panel. An
 * absolutely-positioned bubble inside the page is clipped by the nearest
 * `overflow: hidden` ancestor, and every card in this app is a `.glass`
 * surface, which sets `overflow: hidden` for its blur and edge highlights — so
 * an icon action near a card's edge lost its label entirely. Escaping to
 * `<body>` also lets the bubble stay inside the viewport at the end of a row.
 *
 * Placement is self-correcting: `placement` says which side to try first, and
 * the bubble flips to the other side when that one doesn't fit and clamps
 * horizontally against both edges. Callers never need to guess — a
 * `placement="bottom"` that only existed to dodge clipping can be dropped.
 *
 * The label is never truncated: a long one wraps inside a bounded width rather
 * than being cut off.
 */
export function Tooltip({
  content,
  placement = "top",
  children,
  className,
}: {
  content: string;
  /** Preferred side. The bubble flips when that side doesn't fit. */
  placement?: Side;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Position and side are resolved from measured rects, so they stay null until
  // the bubble has been measured once (see the layout effect below).
  const [position, setPosition] = useState<Position | null>(null);
  const [side, setSide] = useState<Side>(placement);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  useEffect(trackModality, []);

  const close = useCallback(() => {
    setOpen(false);
    setPosition(null);
  }, []);

  // Measure and place before the browser paints. `position` is null on the
  // first frame of an open, so the bubble renders hidden (but laid out, hence
  // measurable) and this effect turns it into real coordinates synchronously —
  // otherwise it would flash at the bottom of <body>, or at whatever stale
  // position the previous open left behind.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const bubble = bubbleRef.current?.getBoundingClientRect();
      if (!anchor || !bubble) return;

      const above = anchor.top - bubble.height - GAP;
      const below = anchor.bottom + GAP;
      const fitsAbove = above >= EDGE;
      const fitsBelow = below + bubble.height <= window.innerHeight - EDGE;
      // Prefer the requested side, flip only when it doesn't fit and the other
      // one does; when neither fits, keep the requested side and let the clamp
      // below decide — a bubble half off-screen still beats no bubble.
      const resolved: Side =
        placement === "top"
          ? fitsAbove || !fitsBelow
            ? "top"
            : "bottom"
          : fitsBelow || !fitsAbove
            ? "bottom"
            : "top";

      const top = Math.max(EDGE, resolved === "top" ? above : below);
      const centered = anchor.left + anchor.width / 2 - bubble.width / 2;
      const left = Math.min(
        Math.max(EDGE, centered),
        Math.max(EDGE, window.innerWidth - bubble.width - EDGE)
      );

      setSide(resolved);
      setPosition({ top, left });
    }
    place();
    // Follow the trigger rather than closing: the trigger may sit inside a
    // scrolling list, and the pointer is still on it.
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, placement, content]);

  // A tooltip must not outlive the hover that created it. `mouseleave` alone is
  // not enough: opening a modal, a toast or a confirm dialog over the hovered
  // trigger moves the pointer's target without the pointer moving, so no leave
  // event ever fires and the bubble is still there after the dialog is
  // dismissed. Every listener here is a way of noticing that the interaction is
  // over — including a pointer move anywhere else while the trigger is no
  // longer the hovered element.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    function onPointerMove(e: PointerEvent) {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const target = e.target as Node | null;
      if (target && anchor.contains(target)) return;
      if (!anchor.matches(":hover")) close();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("blur", close);
    };
  }, [open, close]);

  return (
    <span
      ref={anchorRef}
      className={cn("relative inline-flex", className)}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={close}
      // A press dismisses the label immediately: whatever the control is about
      // to do — open a dialog, submit, navigate — the hover that justified the
      // bubble is over, and the press is the last event that will say so.
      onPointerDown={close}
      onFocus={() => {
        if (lastModality === "keyboard") setOpen(true);
      }}
      onBlur={close}
    >
      {children}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            ref={bubbleRef}
            role="tooltip"
            data-side={side}
            style={
              position
                ? { position: "fixed", top: position.top, left: position.left }
                : // First frame: laid out for measurement, not yet painted.
                  { position: "fixed", top: 0, left: 0, visibility: "hidden" }
            }
            className="pointer-events-none z-50 max-w-[min(18rem,calc(100vw-1rem))] rounded-[var(--radius-d)] bg-[var(--heading)] px-3 py-2 text-center text-xs font-medium leading-snug text-white shadow-[var(--shadow-xs)]"
          >
            {content}
          </span>,
          document.body
        )}
    </span>
  );
}

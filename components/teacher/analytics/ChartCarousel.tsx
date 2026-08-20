"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui/IconButton";

/**
 * A row of charts a teacher scrolls through, with real controls.
 *
 * Three ways in, because a horizontal scroller with none of them is a trap:
 * the previous/next `IconButton`s, native arrow-key scrolling (the track is a
 * focusable `region`, so Tab reaches it and the arrows then move it), and the
 * charts' own focusable marks, which scroll into view as Tab walks them.
 *
 * RTL: the app has one direction, so the geometry is stated once rather than
 * derived. "Previous" is the inline start — visually the RIGHT — so it scrolls
 * by a POSITIVE physical delta; "next" scrolls left by a negative one. Edge
 * detection takes `Math.abs(scrollLeft)` because browsers disagree on whether an
 * RTL container's scroll offset counts up or down from zero, and the absolute
 * distance from the start is the one thing they agree on.
 */
export function ChartCarousel({
  label,
  children,
}: {
  /** Names the group for assistive tech: "תרשימי הכיתה". */
  label: string;
  children: React.ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const offset = Math.abs(track.scrollLeft);
    const scrollable = track.scrollWidth - track.clientWidth;
    setAtStart(offset <= 2);
    setAtEnd(scrollable <= 2 || offset >= scrollable - 2);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    // Measured from a frame callback rather than the effect body, so the first
    // paint isn't a synchronous state write.
    const frame = requestAnimationFrame(measure);
    track.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [measure]);

  function nudge(direction: "previous" | "next") {
    const track = trackRef.current;
    if (!track) return;
    const step = Math.max(track.clientWidth * 0.8, 260);
    track.scrollBy({
      left: direction === "previous" ? step : -step,
      behavior: "smooth",
    });
  }

  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-1">
        <IconButton
          name="chevronRight"
          label="התרשימים הקודמים"
          size="sm"
          disabled={atStart}
          tooltipPlacement="bottom"
          onClick={() => nudge("previous")}
        />
        <IconButton
          name="chevronLeft"
          label="התרשימים הבאים"
          size="sm"
          disabled={atEnd}
          tooltipPlacement="bottom"
          onClick={() => nudge("next")}
        />
      </div>

      {/* The section is the landmark; the track is the focusable control inside
          it, so it gets its own name rather than repeating the section's — two
          landmarks with one name is a duplicate, not a hint. */}
      <div
        ref={trackRef}
        tabIndex={0}
        role="group"
        aria-label="גלילה בין התרשימים"
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)] [scrollbar-width:thin]"
      >
        {children}
      </div>
    </section>
  );
}

/** One slide in a `ChartCarousel` — a fixed-ish width so charts stay legible. */
export function ChartSlide({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-[min(100%,520px)] flex-none snap-start">{children}</div>
  );
}

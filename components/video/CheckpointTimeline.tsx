"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";

export interface TimelineMarker {
  id: string;
  seconds: number;
  /** Accessible label + popover row text (e.g. "שאלה 2"); caller supplies it. */
  label: string;
}

export interface CheckpointTimelineProps {
  /** `null` = duration not known yet (player hasn't reported one) → skeleton, clicks inert. */
  durationSeconds: number | null;
  currentSeconds: number;
  markers: TimelineMarker[];
  activeMarkerId?: string | null;
  /** Click on empty track. */
  onSeek: (seconds: number) => void;
  /** Click on a marker, or an item picked from a cluster popover. Falls back to `onSeek` when omitted. */
  onMarkerClick?: (id: string, seconds: number) => void;
  /** Drag committed on drop. Omitted entirely (or an id absent from `draggableIds`) disables dragging for that marker. */
  onMarkerMove?: (id: string, seconds: number) => void;
  /** Markers eligible to drag — a marker sharing its position with another is never individually draggable regardless of this set. */
  draggableIds?: Set<string>;
  className?: string;
}

/** Whole-second offset as mm:ss (or h:mm:ss past an hour). Kept local — this
 * component is meant to stay dependency-free of any single feature area. */
function formatSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Pointer must travel this many px before a press counts as a drag, not a click.
const DRAG_THRESHOLD_PX = 5;
// Approximate on-screen footprint of a marker, used to cluster near-duplicate
// timestamps that would otherwise render as overlapping, hard-to-hit targets.
const MARKER_FOOTPRINT_PX = 24;

interface Cluster {
  key: string;
  items: TimelineMarker[];
  seconds: number;
}

interface DragState {
  id: string;
  pointerId: number;
  startX: number;
  moved: boolean;
  seconds: number;
}

/**
 * A proportional, clickable, draggable video-time timeline — markers at
 * each checkpoint's position, click-to-seek anywhere on the track, drag a
 * marker to reposition it. Generic on purpose (plain seconds/callbacks, no
 * quiz/question shape) so other video-time UI (e.g. a future AI-generation
 * time-range picker) can reuse it without an API break.
 *
 * Markers sharing (or nearly sharing) a position collapse into one "stack"
 * marker with a count badge rather than rendering N overlapping, unclickable
 * dots — clicking it opens a small popover to pick which one. A stack's
 * items are not individually draggable (there's no single pixel target to
 * grab); give one a distinct timestamp elsewhere first, and it becomes an
 * ordinary draggable marker.
 */
export function CheckpointTimeline({
  durationSeconds,
  currentSeconds,
  markers,
  activeMarkerId = null,
  onSeek,
  onMarkerClick,
  onMarkerMove,
  draggableIds,
  className,
}: CheckpointTimelineProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const clusterRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [trackWidth, setTrackWidth] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [openCluster, setOpenCluster] = useState<string | null>(null);

  const ready = durationSeconds != null && durationSeconds > 0;

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setTrackWidth(el.getBoundingClientRect().width);
    measure();
    // Not available in every test environment (jsdom has no layout engine);
    // the initial `measure()` above still runs, just without live resize
    // updates — fine, since proximity clustering is a soft refinement on top
    // of exact-second clustering, not load-bearing.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Close an open cluster popover on an outside click or Escape.
  useEffect(() => {
    if (openCluster == null) return;
    function onDocPointerDown(e: PointerEvent) {
      const el = clusterRefs.current.get(openCluster as string);
      if (el && !el.contains(e.target as Node)) setOpenCluster(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenCluster(null);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openCluster]);

  function secondsFromClientX(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || durationSeconds == null) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(ratio * durationSeconds);
  }

  function pct(seconds: number): number {
    return ready ? Math.min(100, Math.max(0, (seconds / (durationSeconds as number)) * 100)) : 0;
  }

  const clusters = useMemo<Cluster[]>(() => {
    if (markers.length === 0) return [];
    if (!ready) return markers.map((m) => ({ key: m.id, items: [m], seconds: m.seconds }));
    const sorted = [...markers].sort((a, b) => a.seconds - b.seconds);
    const minGapSeconds =
      trackWidth > 0 ? (MARKER_FOOTPRINT_PX / trackWidth) * (durationSeconds as number) : 0;
    const groups: TimelineMarker[][] = [];
    for (const m of sorted) {
      const last = groups[groups.length - 1];
      if (last && m.seconds - last[last.length - 1].seconds <= minGapSeconds) {
        last.push(m);
      } else {
        groups.push([m]);
      }
    }
    return groups.map((items) => ({
      key: items.map((i) => i.id).join(","),
      items,
      seconds: items[0].seconds,
    }));
  }, [markers, ready, trackWidth, durationSeconds]);

  function fireClick(id: string, seconds: number) {
    if (onMarkerClick) onMarkerClick(id, seconds);
    else onSeek(seconds);
  }

  function handleTrackPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!ready) return;
    onSeek(secondsFromClientX(e.clientX));
  }

  function handleMarkerPointerDown(e: React.PointerEvent<HTMLButtonElement>, m: TimelineMarker) {
    e.stopPropagation();
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: m.id, pointerId: e.pointerId, startX: e.clientX, moved: false, seconds: m.seconds });
  }

  function handleMarkerPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const movedPast = drag.moved || Math.abs(e.clientX - drag.startX) > DRAG_THRESHOLD_PX;
    if (!movedPast) return;
    setDrag({ ...drag, moved: true, seconds: secondsFromClientX(e.clientX) });
  }

  function handleMarkerPointerUp(e: React.PointerEvent<HTMLButtonElement>, m: TimelineMarker) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.moved) {
      onMarkerMove?.(m.id, drag.seconds);
    } else {
      fireClick(m.id, m.seconds);
    }
    setDrag(null);
  }

  const playheadPct = pct(Math.min(currentSeconds, durationSeconds ?? 0));

  return (
    // Video time always flows left→right, even inside the RTL page.
    <div dir="ltr" className={cn("select-none", className)}>
      <div
        ref={trackRef}
        onPointerDown={handleTrackPointerDown}
        data-testid="timeline-track"
        aria-busy={!ready}
        className={cn("relative h-11", ready && "cursor-pointer")}
      >
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full border border-[var(--glass-border)] bg-[var(--neutral-quaternary)]">
          {ready && (
            <div
              className="h-full bg-[var(--brand-softer)] transition-[width] duration-300"
              style={{ width: `${playheadPct}%` }}
            />
          )}
        </div>

        {ready && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--brand)]"
            style={{ left: `${playheadPct}%` }}
          />
        )}

        {ready &&
          clusters.map((cluster) => {
            const isCluster = cluster.items.length > 1;
            const clusterHasActive = cluster.items.some((i) => i.id === activeMarkerId);

            if (!isCluster) {
              const m = cluster.items[0];
              const dragging = drag?.id === m.id && drag.moved;
              const seconds = dragging ? drag.seconds : m.seconds;
              const canDrag = ready && !!(draggableIds?.has(m.id) && onMarkerMove);
              const active = activeMarkerId === m.id;
              return (
                <div
                  key={cluster.key}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${pct(seconds)}%` }}
                >
                  {dragging && (
                    <div className="pointer-events-none absolute bottom-full start-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-d)] bg-[var(--heading)] px-2 py-0.5 font-mono text-xs text-white">
                      {formatSeconds(seconds)}
                    </div>
                  )}
                  <button
                    type="button"
                    data-testid="timeline-marker"
                    title={`${m.label} · ${formatSeconds(m.seconds)}`}
                    aria-label={`${m.label}, ${formatSeconds(m.seconds)}${canDrag ? ". גררו כדי להזיז" : ""}`}
                    aria-current={active ? "true" : undefined}
                    style={{ touchAction: "none" }}
                    onPointerDown={(e) => {
                      // Always — even when this marker isn't draggable — so
                      // the press doesn't bubble to the track's own
                      // pointerdown and fire a second, spurious `onSeek`.
                      e.stopPropagation();
                      if (canDrag) handleMarkerPointerDown(e, m);
                    }}
                    onPointerMove={canDrag ? handleMarkerPointerMove : undefined}
                    onPointerUp={canDrag ? (e) => handleMarkerPointerUp(e, m) : undefined}
                    onPointerCancel={canDrag ? () => setDrag(null) : undefined}
                    onClick={canDrag ? undefined : () => fireClick(m.id, m.seconds)}
                    className={cn(
                      "grid h-6 w-6 place-items-center rounded-full border-2 bg-[var(--brand)] text-white transition",
                      canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                      active
                        ? "border-white ring-4 ring-[var(--brand-softer)]"
                        : "border-[var(--glass-bg)]"
                    )}
                  >
                    <span className="sr-only">{m.label}</span>
                  </button>
                </div>
              );
            }

            return (
              <div
                key={cluster.key}
                ref={(el) => {
                  if (el) clusterRefs.current.set(cluster.key, el);
                  else clusterRefs.current.delete(cluster.key);
                }}
                // stopPropagation here (not per-button) so it also covers
                // the popover's own item buttons below, without needing it
                // repeated on each one.
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${pct(cluster.seconds)}%` }}
              >
                <button
                  type="button"
                  data-testid="timeline-cluster"
                  title={`${cluster.items.length} שאלות · ${formatSeconds(cluster.seconds)}`}
                  aria-label={`${cluster.items.length} שאלות ב-${formatSeconds(cluster.seconds)}`}
                  aria-expanded={openCluster === cluster.key}
                  onClick={() =>
                    setOpenCluster((k) => (k === cluster.key ? null : cluster.key))
                  }
                  className={cn(
                    "relative grid h-6 w-6 place-items-center rounded-full border-2 bg-[var(--brand)] text-white",
                    clusterHasActive
                      ? "border-white ring-4 ring-[var(--brand-softer)]"
                      : "border-[var(--glass-bg)]"
                  )}
                >
                  <span
                    className={cn(
                      "absolute -end-1.5 -top-1.5 grid place-items-center rounded-full bg-[var(--heading)] text-[9px] font-bold leading-none text-white",
                      cluster.items.length > 9 ? "h-3.5 min-w-[16px] px-1" : "h-3.5 w-3.5"
                    )}
                  >
                    {cluster.items.length > 9 ? "9+" : cluster.items.length}
                  </span>
                </button>
                {openCluster === cluster.key && (
                  <div
                    role="menu"
                    aria-label={`שאלות ב-${formatSeconds(cluster.seconds)}`}
                    className="absolute bottom-full start-1/2 z-20 mb-2 max-h-64 w-40 -translate-x-1/2 overflow-y-auto rounded-[var(--radius-d)] border border-[var(--glass-border)] bg-white p-1 shadow-[var(--shadow-md)]"
                  >
                    {cluster.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          fireClick(item.id, item.seconds);
                          setOpenCluster(null);
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-start text-xs text-[var(--heading)] hover:bg-[var(--neutral-quaternary)]"
                      >
                        <span>{item.label}</span>
                        <span className="font-mono text-[var(--body-subtle)]">
                          {formatSeconds(item.seconds)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {ready && (
        <div className="mt-1 flex justify-between font-mono text-[11px] text-[var(--body-subtle)]">
          <span>0:00</span>
          <span>{formatSeconds(durationSeconds as number)}</span>
        </div>
      )}
    </div>
  );
}

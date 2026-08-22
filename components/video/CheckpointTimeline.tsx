"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/Icon";

/**
 * Progress state of a checkpoint, for a read-only timeline (the student
 * player). Optional: an authoring timeline has no such notion and leaves it
 * unset, which renders the plain marker.
 */
export type TimelineMarkerState = "done" | "current" | "upcoming";

export interface TimelineMarker {
  id: string;
  seconds: number;
  /** Accessible label + popover row text (e.g. "שאלה 2"); caller supplies it. */
  label: string;
  /** Only meaningful with `readOnly` — drives the done/current/locked look. */
  state?: TimelineMarkerState;
}

/**
 * Return `false` (or a promise resolving to `false`) to signal the move
 * failed — the dragged marker/cluster snaps back to its old position
 * immediately. Returning `true`/`void` (or a promise thereof) leaves it
 * pinned exactly where it was dropped until the `markers` prop reports the
 * new position, so a save-then-refresh round trip never flickers back to
 * the old spot first.
 */
type MoveResult = boolean | void | Promise<boolean | void>;

export interface CheckpointTimelineProps {
  /** `null` = duration not known yet (player hasn't reported one) → skeleton, clicks inert. */
  durationSeconds: number | null;
  currentSeconds: number;
  markers: TimelineMarker[];
  activeMarkerId?: string | null;
  /**
   * Progress display: no dragging, no cluster popover, and no click-to-seek on
   * the track itself. This is what the student player needs — the bar reports
   * where the questions sit and how far along the student is, and the only
   * navigation on it is the per-marker jump `seekableIds` opts in to (below).
   */
  readOnly?: boolean;
  /** Accessible name of the read-only checkpoint list. */
  label?: string;
  /** Click on empty track. Unused (and unnecessary) when `readOnly`. */
  onSeek?: (seconds: number) => void;
  /** Click on a marker, or an item picked from a cluster popover. Falls back to `onSeek` when omitted. */
  onMarkerClick?: (id: string, seconds: number) => void;
  /**
   * `readOnly` only: the markers the student may jump to. A marker in this set
   * becomes a real seek control (button, hover/focus timestamp, `onMarkerClick`
   * on press); every other marker stays the status node it was and still shows
   * its timestamp on hover — a checkpoint the block-skip gate withholds must
   * not look pressable, but there is no reason to hide *when* it is. Callers
   * derive the set from `canSeekTo` in `./gate`, the one place that rule lives.
   */
  seekableIds?: Set<string>;
  /** Drag committed on drop for a single (non-clustered) marker. Omitted entirely (or an id absent from `draggableIds`) disables dragging for that marker. */
  onMarkerMove?: (id: string, seconds: number) => MoveResult;
  /** Drag committed on drop for an entire cluster — every clustered question moves to the same new instant together. Omitted (or any member missing from `draggableIds`) disables dragging for that cluster; it stays click-to-open-popover only. */
  onClusterMove?: (ids: string[], seconds: number) => MoveResult;
  /** Markers eligible to drag. A cluster is draggable only when every one of its members is in this set. */
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

// A floating element (time bubble / popover) centers on its anchor by
// default, but that overflows the track near either edge — flip to a
// flush edge anchor once the anchor is close enough to one.
function edgeAnchorClasses(posPct: number): string {
  if (posPct < 15) return "start-0";
  if (posPct > 85) return "end-0";
  return "start-1/2 -translate-x-1/2";
}

// Pointer must travel this many px before a press counts as a drag, not a click.
const DRAG_THRESHOLD_PX = 5;
// Approximate on-screen footprint of a marker, used to cluster near-duplicate
// timestamps that would otherwise render as overlapping, hard-to-hit targets.
const MARKER_FOOTPRINT_PX = 24;
// Safety net: if a committed move's `markers` prop never converges on the
// dropped position (an unexpected caller contract mismatch, not the normal
// path), stop pinning the optimistic position after this long.
const PENDING_MOVE_TIMEOUT_MS = 5000;

interface Cluster {
  key: string;
  items: TimelineMarker[];
  seconds: number;
}

interface DragState {
  ids: string[];
  pointerId: number;
  startX: number;
  moved: boolean;
  seconds: number;
}

/** A drag just dropped: hold its ids at `seconds` until the `markers` prop
 * confirms the move landed (or the caller reports failure), so the marker
 * never visibly snaps back to the old position while the save is in flight. */
interface PendingMove {
  seq: number;
  ids: string[];
  seconds: number;
}

function overlapsIds(ids: string[], items: TimelineMarker[]): boolean {
  return items.some((it) => ids.includes(it.id));
}

function idsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((id) => setA.has(id));
}

/**
 * A proportional, clickable, draggable video-time timeline — markers at
 * each checkpoint's position, click-to-seek anywhere on the track, drag a
 * marker (or a whole cluster) to reposition it. Generic on purpose (plain
 * seconds/callbacks, no quiz/question shape) so other video-time UI (e.g. a
 * future AI-generation time-range picker) can reuse it without an API break.
 *
 * Markers sharing (or nearly sharing) a position collapse into one "stack"
 * marker with a count badge rather than rendering N overlapping, unclickable
 * dots — clicking it opens a small popover to pick which one, dragging it
 * moves every clustered question to the same new instant together.
 *
 * `readOnly` turns the same geometry into the student player's progress
 * display: the bar tracks playback and each checkpoint shows whether it is
 * answered, current or still locked. Dragging, the cluster popover and
 * click-anywhere-on-the-track are all gone there; the one navigation left is
 * a jump to a checkpoint the block-skip gate already allows, opted into per
 * marker through `seekableIds`.
 */
export function CheckpointTimeline({
  durationSeconds,
  currentSeconds,
  markers,
  activeMarkerId = null,
  readOnly = false,
  label,
  onSeek,
  onMarkerClick,
  onMarkerMove,
  onClusterMove,
  draggableIds,
  seekableIds,
  className,
}: CheckpointTimelineProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const clusterRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [trackWidth, setTrackWidth] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [openCluster, setOpenCluster] = useState<string | null>(null);
  const commitSeq = useRef(0);

  const ready = durationSeconds != null && durationSeconds > 0;

  // Clear a pending move once the incoming `markers` prop actually shows
  // every dragged id at the dropped position — i.e. the save + refresh
  // landed. Adjusted during render rather than in an effect (same pattern
  // QuestionModal uses to re-seed on a prop change): the check is cheap,
  // idempotent, and converges in the same render (once cleared, the
  // condition is false), so it never loops.
  if (pendingMove) {
    const confirmed = pendingMove.ids.every((id) => {
      const m = markers.find((mk) => mk.id === id);
      return m != null && Math.round(m.seconds) === Math.round(pendingMove.seconds);
    });
    if (confirmed) setPendingMove(null);
  }

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

  // Safety net matching VideoStage's own "never hang forever" convention —
  // covers a caller whose `markers` prop never converges as expected.
  useEffect(() => {
    if (!pendingMove) return;
    const t = setTimeout(() => setPendingMove(null), PENDING_MOVE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [pendingMove]);

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
    else onSeek?.(seconds);
  }

  function handleTrackPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!ready) return;
    onSeek?.(secondsFromClientX(e.clientX));
  }

  function handleDragPointerDown(
    e: React.PointerEvent<HTMLButtonElement>,
    ids: string[],
    seconds: number
  ) {
    e.stopPropagation();
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ ids, pointerId: e.pointerId, startX: e.clientX, moved: false, seconds });
  }

  function handleDragPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const movedPast = drag.moved || Math.abs(e.clientX - drag.startX) > DRAG_THRESHOLD_PX;
    if (!movedPast) return;
    setDrag({ ...drag, moved: true, seconds: secondsFromClientX(e.clientX) });
  }

  /** Drop: pin the optimistic position (see `pendingMove` above) rather than
   * clearing immediately, so the marker doesn't jump back to its old spot
   * for the moment before the save's refresh actually lands. */
  function commitDrag(ids: string[], seconds: number) {
    const seq = ++commitSeq.current;
    setPendingMove({ seq, ids, seconds });
    const result =
      ids.length === 1 ? onMarkerMove?.(ids[0], seconds) : onClusterMove?.(ids, seconds);
    Promise.resolve(result).then((ok) => {
      if (ok === false) {
        // Explicit failure — revert now rather than waiting for a prop
        // update that will never come. Guarded by `seq` so a stale
        // resolution can't clobber a newer drag on the same marker(s).
        setPendingMove((p) => (p && p.seq === seq ? null : p));
      }
    });
  }

  function handleDragPointerUp(
    e: React.PointerEvent<HTMLButtonElement>,
    ids: string[],
    onClickInstead: () => void
  ) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.moved) {
      commitDrag(ids, drag.seconds);
    } else {
      onClickInstead();
    }
    setDrag(null);
  }

  const playheadPct = pct(Math.min(currentSeconds, durationSeconds ?? 0));

  return (
    // Video time always flows left→right, even inside the RTL page.
    <div dir="ltr" className={cn("select-none", className)}>
      <div
        ref={trackRef}
        {...(readOnly
          ? { role: "list", "aria-label": label ?? "נקודות העצירה" }
          : { onPointerDown: handleTrackPointerDown })}
        data-testid="timeline-track"
        aria-busy={!ready}
        className={cn("relative h-11", !readOnly && ready && "cursor-pointer")}
      >
        {/* The bar: watched portion filled, like a video scrubber. Decoration —
            the playhead's meaning is carried by the video player itself. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full border border-[var(--glass-border)] bg-[var(--neutral-quaternary)]"
        >
          {ready && (
            <div
              data-testid="timeline-progress"
              className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-200 ease-linear"
              style={{ width: `${playheadPct}%` }}
            />
          )}
        </div>

        {ready && (
          <div
            aria-hidden="true"
            data-testid="timeline-playhead"
            className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-200 ease-linear"
            style={{ left: `${playheadPct}%` }}
          >
            <span className="block h-3.5 w-3.5 rounded-full border-2 border-white bg-[var(--brand-strong)] shadow-[var(--shadow-xs)]" />
          </div>
        )}

        {ready &&
          clusters.map((cluster) => {
            const isCluster = cluster.items.length > 1;
            const ids = cluster.items.map((i) => i.id);
            const clusterHasActive = cluster.items.some((i) => i.id === activeMarkerId);

            const activeDrag = drag && idsEqual(drag.ids, ids) ? drag : null;
            const dragging = !!activeDrag?.moved;
            const pending = !dragging && pendingMove && overlapsIds(pendingMove.ids, cluster.items)
              ? pendingMove
              : null;
            const seconds = dragging
              ? (activeDrag as DragState).seconds
              : pending
                ? pending.seconds
                : cluster.seconds;
            const posPct = pct(seconds);

            if (readOnly) {
              // A stack is jumpable only when every question in it is — the
              // jump lands on one instant, so a locked member would be
              // reachable through its answered neighbour otherwise.
              const seekable =
                cluster.items.every((i) => seekableIds?.has(i.id)) &&
                !!(onMarkerClick ?? onSeek);
              return (
                // `listitem` sits on the wrapper rather than on the node
                // itself, so a jumpable checkpoint can be a real button
                // inside it. `group` drives the hover/focus timestamp.
                <div
                  key={cluster.key}
                  role="listitem"
                  className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${posPct}%` }}
                >
                  <TimeBubble
                    seconds={cluster.seconds}
                    posPct={posPct}
                    className="hidden group-hover:block group-focus-within:block"
                  />
                  <ReadOnlyNode
                    items={cluster.items}
                    seconds={cluster.seconds}
                    seekable={seekable}
                    onSeek={
                      seekable
                        ? () => fireClick(cluster.items[0].id, cluster.seconds)
                        : undefined
                    }
                  />
                </div>
              );
            }

            if (!isCluster) {
              const m = cluster.items[0];
              const canDrag = ready && !!(draggableIds?.has(m.id) && onMarkerMove);
              const active = activeMarkerId === m.id;
              return (
                <div
                  key={cluster.key}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${posPct}%` }}
                >
                  {dragging && <TimeBubble seconds={seconds} posPct={posPct} />}
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
                      if (canDrag) handleDragPointerDown(e, [m.id], m.seconds);
                    }}
                    onPointerMove={canDrag ? handleDragPointerMove : undefined}
                    onPointerUp={
                      canDrag
                        ? (e) => handleDragPointerUp(e, [m.id], () => fireClick(m.id, m.seconds))
                        : undefined
                    }
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

            const canDragCluster =
              ready && !!(onClusterMove && ids.every((id) => draggableIds?.has(id)));

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
                style={{ left: `${posPct}%` }}
              >
                {dragging && <TimeBubble seconds={seconds} posPct={posPct} />}
                <button
                  type="button"
                  data-testid="timeline-cluster"
                  title={`${cluster.items.length} שאלות · ${formatSeconds(cluster.seconds)}${canDragCluster ? " · גררו כדי להזיז יחד" : ""}`}
                  aria-label={`${cluster.items.length} שאלות ב-${formatSeconds(cluster.seconds)}`}
                  aria-expanded={openCluster === cluster.key}
                  style={{ touchAction: "none" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (canDragCluster) handleDragPointerDown(e, ids, cluster.seconds);
                  }}
                  onPointerMove={canDragCluster ? handleDragPointerMove : undefined}
                  onPointerUp={
                    canDragCluster
                      ? (e) =>
                          handleDragPointerUp(e, ids, () =>
                            setOpenCluster((k) => (k === cluster.key ? null : cluster.key))
                          )
                      : undefined
                  }
                  onPointerCancel={canDragCluster ? () => setDrag(null) : undefined}
                  onClick={
                    canDragCluster
                      ? undefined
                      : () => setOpenCluster((k) => (k === cluster.key ? null : cluster.key))
                  }
                  className={cn(
                    "relative grid h-6 w-6 place-items-center rounded-full border-2 bg-[var(--brand)] text-white",
                    canDragCluster ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
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
                    className={cn(
                      "absolute bottom-full z-20 mb-2 max-h-64 w-40 overflow-y-auto rounded-[var(--radius-d)] border border-[var(--glass-border)] bg-white p-1 shadow-[var(--shadow-md)]",
                      edgeAnchorClasses(posPct)
                    )}
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

/** What a read-only marker's appearance means, spelled out for assistive tech. */
const MARKER_STATE_LABEL: Record<TimelineMarkerState, string> = {
  done: "נענתה",
  current: "השאלה הנוכחית",
  upcoming: "טרם נפתחה",
};

/** The telling state of a stack of checkpoints: the current one wins, then done. */
function groupState(items: TimelineMarker[]): TimelineMarkerState | undefined {
  if (items.some((i) => i.state === "current")) return "current";
  if (items.every((i) => i.state === "done")) return "done";
  return items.some((i) => i.state != null) ? "upcoming" : undefined;
}

/**
 * One checkpoint (or a stack of near-simultaneous ones) on a `readOnly`
 * timeline. Its appearance carries the state visually — answered, current,
 * still locked — and an sr-only line per clustered question carries the same
 * in words, since neither the shape nor the position is available to a screen
 * reader.
 *
 * `seekable` decides what it *is*: a button that jumps the video back to this
 * instant when the gate allows it, or the plain status node it has always been
 * when it doesn't. Only the element and the hover affordance change; the
 * status appearance is identical either way, so the timeline still reads as
 * one row of checkpoints rather than a mix of controls and decorations.
 */
function ReadOnlyNode({
  items,
  seconds,
  seekable,
  onSeek,
}: {
  items: TimelineMarker[];
  seconds: number;
  seekable: boolean;
  onSeek?: () => void;
}) {
  const state = groupState(items);
  const count = items.length;
  const As = seekable ? "button" : "span";
  return (
    <As
      {...(seekable ? { type: "button" as const, onClick: onSeek } : {})}
      data-testid="checkpoint-marker"
      data-state={state ?? "upcoming"}
      data-seconds={seconds}
      className={cn(
        "relative grid h-6 w-6 place-items-center rounded-full border-2 transition-colors",
        seekable && "cursor-pointer hover:ring-4 hover:ring-[var(--brand-soft)]",
        state === "done"
          ? "border-[var(--brand)] bg-[var(--brand)] text-white"
          : state === "current"
            ? "border-[var(--brand)] bg-white ring-4 ring-[var(--brand-softer)]"
            : "border-[var(--neutral-quaternary)] bg-white text-[var(--body-subtle)]"
      )}
    >
      {state === "done" ? (
        <Icon name="check" size={14} />
      ) : state === "current" ? (
        <span
          aria-hidden="true"
          className="block h-2 w-2 rounded-full bg-[var(--brand)]"
        />
      ) : (
        <Icon name="lock" size={12} />
      )}
      {count > 1 && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute -end-1.5 -top-1.5 grid place-items-center rounded-full bg-[var(--heading)] text-[9px] font-bold leading-none text-white",
            count > 9 ? "h-3.5 min-w-[16px] px-1" : "h-3.5 w-3.5"
          )}
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
      {items.map((item) => (
        <span key={item.id} className="sr-only">
          {`${item.label} · ${formatSeconds(item.seconds)}${
            item.state ? ` · ${MARKER_STATE_LABEL[item.state]}` : ""
          }`}
        </span>
      ))}
      {/* Part of the accessible name rather than a title/tooltip: a button
          whose whole label is "שאלה 2 · 1:20 · נענתה" says what it is but not
          what pressing it does. */}
      {seekable && <span className="sr-only">· מעבר לנקודה זו בסרטון</span>}
    </As>
  );
}

/**
 * The mm:ss flag above a marker: the live readout while a marker is dragged on
 * an authoring timeline, and the hover/focus readout of a checkpoint's position
 * on the student's. Same shape in both, since it answers the same question.
 */
function TimeBubble({
  seconds,
  posPct,
  className,
}: {
  seconds: number;
  posPct: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-[var(--radius-d)] bg-[var(--heading)] px-2 py-0.5 font-mono text-xs text-white",
        edgeAnchorClasses(posPct),
        className
      )}
    >
      {formatSeconds(seconds)}
    </span>
  );
}

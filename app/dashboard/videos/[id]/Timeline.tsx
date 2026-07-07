"use client";

import { useRef, useState } from "react";
import { fmtSec, type SavedCheckpoint } from "./shared";

interface Props {
  checkpoints: SavedCheckpoint[];
  duration: number;
  selectedCpId: string | null;
  currentTime: number;
  onSelect: (id: string) => void;
  onSeek: (seconds: number) => void;
  onMove: (id: string, seconds: number) => void;
}

// Pointer must travel this many px before a press counts as a drag, not a tap.
const DRAG_THRESHOLD_PX = 5;

interface DragState {
  cpId: string;
  pointerId: number;
  startX: number;
  moved: boolean;
  seconds: number;
}

export default function Timeline({
  checkpoints,
  duration,
  selectedCpId,
  currentTime,
  onSelect,
  onSeek,
  onMove,
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const ready = duration > 0;

  function secondsFromClientX(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(pct * duration);
  }

  function pct(seconds: number): number {
    return ready ? Math.min(100, (seconds / duration) * 100) : 0;
  }

  function handleTrackPointerDown(e: React.PointerEvent) {
    if (!ready) return;
    onSeek(secondsFromClientX(e.clientX));
  }

  function handleMarkerPointerDown(e: React.PointerEvent, cp: SavedCheckpoint) {
    e.stopPropagation();
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      cpId: cp.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      moved: false,
      seconds: cp.position_seconds,
    });
  }

  function handleMarkerPointerMove(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const moved =
      drag.moved || Math.abs(e.clientX - drag.startX) > DRAG_THRESHOLD_PX;
    if (!moved) return;
    setDrag({ ...drag, moved: true, seconds: secondsFromClientX(e.clientX) });
  }

  function handleMarkerPointerUp(e: React.PointerEvent, cp: SavedCheckpoint) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.moved) {
      onMove(cp.id, drag.seconds);
    } else {
      onSelect(cp.id);
      onSeek(cp.position_seconds);
    }
    setDrag(null);
  }

  const playheadPct = pct(Math.min(currentTime, duration));

  return (
    // Video time always flows left→right, even on the RTL page.
    <div dir="ltr">
      {/* Track — tall touch target, thin visual bar centered inside */}
      <div
        ref={trackRef}
        onPointerDown={handleTrackPointerDown}
        className="relative h-11 cursor-pointer select-none"
      >
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2.5 rounded-full bg-gray-800 border border-gray-700/60 overflow-hidden">
          {/* Watched progress fill */}
          <div
            className="h-full bg-blue-500/25 transition-[width] duration-300"
            style={{ width: `${playheadPct}%` }}
          />
        </div>

        {/* Playhead */}
        {ready && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-5 bg-blue-400 rounded-full pointer-events-none"
            style={{ left: `${playheadPct}%` }}
          />
        )}

        {/* Checkpoint markers */}
        {checkpoints.map((cp) => {
          const dragging = drag?.cpId === cp.id && drag.moved;
          const seconds = dragging ? drag.seconds : cp.position_seconds;
          const active = selectedCpId === cp.id;
          return (
            <button
              key={cp.id}
              type="button"
              title={`${fmtSec(cp.position_seconds)} — ${cp.questions.length} שאלות (גררו כדי להזיז)`}
              aria-label={`שאלות ב-${fmtSec(cp.position_seconds)}, ${cp.questions.length} שאלות. גררו כדי להזיז.`}
              onPointerDown={(e) => handleMarkerPointerDown(e, cp)}
              onPointerMove={handleMarkerPointerMove}
              onPointerUp={(e) => handleMarkerPointerUp(e, cp)}
              onPointerCancel={() => setDrag(null)}
              style={{ left: `${pct(seconds)}%`, touchAction: "none" }}
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 ${
                ready ? "cursor-grab active:cursor-grabbing" : "cursor-default"
              }`}
            >
              {/* Time bubble while dragging */}
              {dragging && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-mono px-2 py-0.5 rounded-md whitespace-nowrap pointer-events-none shadow-lg">
                  {fmtSec(seconds)}
                </div>
              )}
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold ring-2 transition-all ${
                  dragging
                    ? "bg-blue-500 text-white ring-blue-300 scale-110 shadow-lg"
                    : active
                      ? "bg-blue-500 text-white ring-blue-300/60"
                      : "bg-gray-600 text-gray-200 ring-[#161920] hover:bg-blue-600 hover:text-white"
                }`}
              >
                {cp.questions.length}
              </div>
            </button>
          );
        })}
      </div>

      {/* Time labels */}
      <div className="flex justify-between text-[11px] text-gray-500 font-mono -mt-1">
        <span>0:00</span>
        <span>{ready ? fmtSec(Math.floor(duration)) : "–:––"}</span>
      </div>
    </div>
  );
}

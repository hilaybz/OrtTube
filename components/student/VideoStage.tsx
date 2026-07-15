"use client";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/Icon";
import { gateDecision } from "./gate";

const YouTube = dynamic(() => import("react-youtube"), { ssr: false });

export interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setVolume(v: number): void;
  getVolume(): number;
}

export interface VideoStageHandle {
  seekTo(seconds: number): void;
  play(): void;
  pause(): void;
}

export interface Marker {
  seconds: number;
  done: boolean;
  current: boolean;
  label: string;
}

function mmss(t: number): string {
  const s = Math.max(0, Math.floor(t || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A branded video player: the YouTube iframe with its own chrome hidden
 * (`controls:0`, `pointer-events:none`), driven entirely through the IFrame API,
 * with our glass control bar (play/pause, checkpoint scrubber, time, volume +
 * mute, fullscreen). Block-skip is enforced here — the playhead can't advance
 * past `maxSeek` (the current unanswered checkpoint). `overlay` (the question
 * card) hides the controls while it's up.
 */
export const VideoStage = forwardRef<
  VideoStageHandle,
  {
    videoId: string;
    markers: Marker[];
    maxSeek: number | null;
    overlay?: React.ReactNode;
    onTime?: (t: number) => void;
  }
>(function VideoStage({ videoId, markers, maxSeek, overlay, onTime }, ref) {
  const playerRef = useRef<YTPlayer | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const prevMax = useRef<number | null | undefined>(undefined);

  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);

  const seek = useCallback(
    (s: number) => {
      const clamped = maxSeek != null ? Math.min(s, maxSeek) : Math.max(0, s);
      try {
        playerRef.current?.seekTo(clamped, true);
      } catch {
        /* ignore */
      }
      setCurrent(clamped);
      onTime?.(clamped);
    },
    [maxSeek, onTime]
  );

  useImperativeHandle(
    ref,
    () => ({
      seekTo: (s: number) => seek(s),
      play: () => {
        try {
          playerRef.current?.playVideo();
        } catch {
          /* ignore */
        }
      },
      pause: () => {
        try {
          playerRef.current?.pauseVideo();
        } catch {
          /* ignore */
        }
      },
    }),
    [seek]
  );

  // Poll playback; enforce the block-skip gate.
  useEffect(() => {
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      let t: number;
      let d = 0;
      let st = 2;
      try {
        t = p.getCurrentTime() ?? 0;
        d = p.getDuration() ?? 0;
        st = p.getPlayerState?.() ?? 2;
      } catch {
        return;
      }
      if (typeof t !== "number" || Number.isNaN(t)) return;
      const { atGate, clampTo } = gateDecision(t, maxSeek);
      if (clampTo != null) {
        try {
          p.seekTo(clampTo, true);
        } catch {
          /* ignore */
        }
        t = clampTo;
      }
      if (atGate) {
        try {
          p.pauseVideo();
        } catch {
          /* ignore */
        }
      }
      setDuration(d);
      setPlaying(st === 1);
      const next = t;
      setCurrent((prev) => (next === 0 && prev > 0 ? prev : next));
      onTime?.(next === 0 && current > 0 ? current : next);
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxSeek]);

  // Resume playback when the gate advances (a question was answered).
  useEffect(() => {
    if (prevMax.current !== undefined && maxSeek !== prevMax.current) {
      const advanced =
        maxSeek === null ||
        (prevMax.current !== null &&
          prevMax.current !== undefined &&
          maxSeek > prevMax.current);
      if (advanced && !overlay) {
        try {
          playerRef.current?.playVideo();
        } catch {
          /* ignore */
        }
      }
    }
    prevMax.current = maxSeek;
  }, [maxSeek, overlay]);

  function togglePlay() {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (playing) p.pauseVideo();
      else p.playVideo();
    } catch {
      /* ignore */
    }
  }
  function toggleMute() {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (muted) {
        p.unMute();
        setMuted(false);
      } else {
        p.mute();
        setMuted(true);
      }
    } catch {
      /* ignore */
    }
  }
  function changeVolume(v: number) {
    setVolume(v);
    const p = playerRef.current;
    try {
      p?.setVolume(v);
      if (v > 0 && muted) {
        p?.unMute();
        setMuted(false);
      } else if (v === 0) {
        p?.mute();
        setMuted(true);
      }
    } catch {
      /* ignore */
    }
  }
  function toggleFullscreen() {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }
  function onTrackPointer(e: React.PointerEvent<HTMLDivElement>) {
    if (duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seek(frac * duration);
  }

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const capPct =
    maxSeek != null && duration > 0 ? Math.min(100, (maxSeek / duration) * 100) : 100;

  return (
    <div
      ref={wrapRef}
      className="relative overflow-hidden rounded-[var(--radius)] border border-[var(--glass-border)] bg-black shadow-[0_20px_50px_-24px_rgba(15,23,42,0.55)]"
    >
      <div className="aspect-video">
        <YouTube
          videoId={videoId}
          className="h-full w-full"
          iframeClassName="pointer-events-none h-full w-full"
          opts={{
            width: "100%",
            height: "100%",
            playerVars: {
              controls: 0,
              rel: 0,
              modestbranding: 1,
              disablekb: 1,
              playsinline: 1,
              iv_load_policy: 3,
            },
          }}
          onReady={(e: { target: YTPlayer }) => {
            playerRef.current = e.target;
            try {
              setVolume(e.target.getVolume());
              setMuted(e.target.isMuted());
            } catch {
              /* ignore */
            }
          }}
        />
      </div>

      {!overlay && (
        <>
          {/* click-to-toggle layer */}
          <button
            type="button"
            aria-label={playing ? "השהיה" : "נגן"}
            onClick={togglePlay}
            className="absolute inset-0 z-10"
          />
          {!playing && (
            <span className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-black/50 backdrop-blur">
                <Icon name="play" size={28} className="text-white" />
              </span>
            </span>
          )}

          {/* control bar (LTR — media timelines read left→right) */}
          <div
            dir="ltr"
            className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-1 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2 pt-8"
          >
            <div className="relative h-3 cursor-pointer" onPointerDown={onTrackPointer}>
              <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/25" />
              {capPct < 100 && (
                <div
                  className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/10"
                  style={{ left: `${capPct}%`, right: 0 }}
                />
              )}
              <div
                className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--brand)]"
                style={{ width: `${pct}%` }}
              />
              {markers.map((m) => {
                const left =
                  duration > 0 ? Math.min(100, (m.seconds / duration) * 100) : 0;
                return (
                  <button
                    key={m.seconds}
                    type="button"
                    title={m.label}
                    aria-label={m.current ? "מעבר לנקודת העצירה" : m.label}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (m.done || m.current) seek(m.seconds);
                    }}
                    className={cn(
                      "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black",
                      m.done
                        ? "bg-[var(--brand)]"
                        : m.current
                          ? "bg-white ring-2 ring-[var(--brand)]"
                          : "bg-white/40"
                    )}
                    style={{ left: `${left}%` }}
                  />
                );
              })}
            </div>

            <div className="flex items-center gap-3 text-white">
              <button type="button" onClick={togglePlay} aria-label={playing ? "השהיה" : "נגן"} className="p-1">
                <Icon name={playing ? "pause" : "play"} size={20} className="text-white" />
              </button>
              <span className="font-mono text-xs tabular-nums">
                {mmss(current)} / {mmss(duration)}
              </span>
              <div className="ms-auto flex items-center gap-2">
                <button type="button" onClick={toggleMute} aria-label={muted ? "ביטול השתקה" : "השתקה"} className="p-1">
                  <Icon name={muted ? "volumeOff" : "volume"} size={18} className="text-white" />
                </button>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={muted ? 0 : volume}
                  onChange={(e) => changeVolume(Number(e.target.value))}
                  aria-label="עוצמת שמע"
                  className="h-1 w-20 accent-[var(--brand)]"
                />
                <button type="button" onClick={toggleFullscreen} aria-label="מסך מלא" className="p-1">
                  <Icon name="fullscreen" size={18} className="text-white" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {overlay}
    </div>
  );
});

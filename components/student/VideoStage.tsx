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
import { Spinner } from "@/components/ui/Spinner";
import { gateDecision } from "./gate";

const YouTube = dynamic(() => import("react-youtube"), { ssr: false });

export interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
}

export interface VideoStageHandle {
  seekTo(seconds: number): void;
  play(): void;
  pause(): void;
}

/**
 * The video player: YouTube's own iframe with its native controls (like the
 * original), inside a framed stage. Block-skip is enforced by the playhead poll
 * — playback can't advance past `maxSeek` (the current unanswered checkpoint).
 * `overlay` (the question card) renders over the video. The checkpoint indicator
 * lives OUTSIDE this component (a rail below), so it doesn't fight YouTube's UI.
 */
export const VideoStage = forwardRef<
  VideoStageHandle,
  {
    videoId: string;
    maxSeek: number | null;
    overlay?: React.ReactNode;
    onProgress?: (current: number, duration: number) => void;
  }
>(function VideoStage({ videoId, maxSeek, overlay, onProgress }, ref) {
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const currentRef = useRef(0);
  const durRef = useRef(0);
  const pendingRef = useRef<number | null>(null); // optimistic seek target
  const prevMax = useRef<number | null | undefined>(undefined);

  const seek = useCallback(
    (s: number) => {
      const clamped = maxSeek != null ? Math.min(s, maxSeek) : Math.max(0, s);
      try {
        playerRef.current?.seekTo(clamped, true);
      } catch {
        /* ignore */
      }
      // Hold this position until the (possibly-still-playing) player catches up,
      // so a poll tick can't yank the reported time back to where it was.
      pendingRef.current = clamped;
      currentRef.current = clamped;
      onProgress?.(clamped, durRef.current);
    },
    [maxSeek, onProgress]
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

  useEffect(() => {
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      let t: number;
      let d = 0;
      try {
        t = p.getCurrentTime() ?? 0;
        d = p.getDuration() ?? 0;
      } catch {
        return;
      }
      if (typeof t !== "number" || Number.isNaN(t)) return;
      durRef.current = d;
      const { clampTo } = gateDecision(t, maxSeek);
      if (clampTo != null) {
        try {
          p.seekTo(clampTo, true);
        } catch {
          /* ignore */
        }
        t = clampTo;
      }
      // Optimistic-seek latch: keep reporting the seek target until the real
      // playhead reaches it (within 1s), then release.
      if (pendingRef.current != null) {
        if (Math.abs(t - pendingRef.current) <= 1) pendingRef.current = null;
        else t = pendingRef.current;
      }
      if (maxSeek != null && t >= maxSeek - 0.05) {
        try {
          p.pauseVideo();
        } catch {
          /* ignore */
        }
      }
      const next = t === 0 && currentRef.current > 0 ? currentRef.current : t;
      currentRef.current = next;
      onProgress?.(next, d);
    }, 250);
    return () => clearInterval(id);
  }, [maxSeek, onProgress]);

  // Resume when the gate advances (a question was answered).
  useEffect(() => {
    if (prevMax.current !== undefined && maxSeek !== prevMax.current) {
      const advanced =
        maxSeek === null || (prevMax.current != null && maxSeek > prevMax.current);
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

  return (
    <div className="relative overflow-hidden rounded-[var(--radius)] border border-[var(--glass-border)] bg-black shadow-[0_20px_50px_-24px_rgba(15,23,42,0.55)]">
      <div className="aspect-video">
        <YouTube
          videoId={videoId}
          className="h-full w-full"
          iframeClassName="h-full w-full"
          opts={{
            width: "100%",
            height: "100%",
            playerVars: { rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3 },
          }}
          onReady={(e: { target: YTPlayer }) => {
            playerRef.current = e.target;
            setReady(true);
          }}
        />
      </div>

      {/* Poster + spinner while the YouTube iframe boots (~1–2s), so it doesn't
          flash an empty black frame. */}
      {!ready && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-50"
          />
          <Spinner size={30} className="relative text-white" />
        </div>
      )}

      {overlay}
    </div>
  );
});

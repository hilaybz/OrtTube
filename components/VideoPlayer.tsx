"use client";

import { useEffect, useRef, useState } from "react";
import YouTube, { type YouTubeEvent, type YouTubePlayer } from "react-youtube";
import QuizModal from "@/components/QuizModal";
import { QUIZ_CHECKPOINTS, type QuizCheckpoint } from "@/lib/demoQuiz";
import type { TranscriptSegment } from "@/lib/transcript";

interface Props {
  videoId: string;
}

type QuizSource = "loading" | "ai" | "demo";

const POLL_INTERVAL_MS = 500;

export default function VideoPlayer({ videoId }: Props) {
  const playerRef = useRef<YouTubePlayer | null>(null);
  const [checkpoints, setCheckpoints] = useState<QuizCheckpoint[]>(QUIZ_CHECKPOINTS);
  const [quizSource, setQuizSource] = useState<QuizSource>("loading");
  const [activeQuiz, setActiveQuiz] = useState<QuizCheckpoint | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[] | null>(null);
  const triggeredRef = useRef<Set<number>>(new Set());

  // Fetch AI-generated quizzes in the background while the video loads
  useEffect(() => {
    fetch(`/api/quizzes?videoId=${videoId}`)
      .then((r) => r.json())
      .then(({ checkpoints: aiCheckpoints, source, transcript: segments }) => {
        setCheckpoints(aiCheckpoints);
        setQuizSource(source === "ai" ? "ai" : "demo");
        if (segments) setTranscript(segments);
      })
      .catch(() => setQuizSource("demo"));
  }, [videoId]);

  // Poll video progress and trigger quizzes at checkpoints
  useEffect(() => {
    const interval = setInterval(() => {
      const player = playerRef.current;
      if (!player || activeQuiz) return;

      const duration: number = player.getDuration();
      const currentTime: number = player.getCurrentTime();
      if (!duration || duration <= 0) return;

      const percent = (currentTime / duration) * 100;

      for (const checkpoint of checkpoints) {
        if (percent >= checkpoint.percent && !triggeredRef.current.has(checkpoint.percent)) {
          triggeredRef.current.add(checkpoint.percent);
          player.pauseVideo();
          setActiveQuiz(checkpoint);
          break;
        }
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [activeQuiz, checkpoints]);

  function onReady(event: YouTubeEvent) {
    playerRef.current = event.target;
  }

  function handleQuizComplete() {
    setActiveQuiz(null);
    playerRef.current?.playVideo();
  }

  return (
    <div className="relative w-full">
      {/* Checkpoint progress bar */}
      <CheckpointBar triggered={triggeredRef.current} />

      {/* Quiz status pill */}
      <QuizStatusPill source={quizSource} />

      {/* YouTube embed — 16:9 */}
      <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
        <YouTube
          videoId={videoId}
          onReady={onReady}
          opts={{
            width: "100%",
            height: "100%",
            playerVars: { autoplay: 0, modestbranding: 1, rel: 0, fs: 1 },
          }}
          className="absolute inset-0 w-full h-full"
          iframeClassName="w-full h-full rounded-b-xl"
        />
      </div>

      {activeQuiz && (
        <QuizModal checkpoint={activeQuiz} onComplete={handleQuizComplete} />
      )}

      {/* Debug: transcript */}
      {transcript && (
        <div className="mt-4 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-gray-800/50 text-xs text-gray-400 font-mono flex items-center gap-2">
            <span className="text-yellow-500">DEBUG</span> transcript —{" "}
            {transcript.length} segments
          </div>
          <div className="max-h-64 overflow-y-auto px-4 py-3 space-y-1 font-mono text-xs text-gray-400">
            {transcript.map((seg, i) => (
              <div key={i} className="flex gap-3">
                <span className="text-gray-600 shrink-0 w-16 text-right">
                  {formatMs(seg.offset)}
                </span>
                <span>{seg.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function CheckpointBar({ triggered }: { triggered: Set<number> }) {
  return (
    <div className="relative h-1 bg-gray-800 rounded-t-xl overflow-visible">
      {QUIZ_CHECKPOINTS.map((cp) => (
        <div
          key={cp.percent}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
          style={{ left: `${cp.percent}%` }}
          title={`${cp.label} at ${cp.percent}%`}
        >
          <div
            className={`w-3 h-3 rounded-full border-2 border-[#0f1117] transition-colors ${
              triggered.has(cp.percent) ? "bg-blue-400" : "bg-gray-600"
            }`}
          />
        </div>
      ))}
    </div>
  );
}

function QuizStatusPill({ source }: { source: QuizSource }) {
  if (source === "loading") {
    return (
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm text-gray-400 text-xs px-2.5 py-1 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
        Generating quiz…
      </div>
    );
  }
  if (source === "ai") {
    return (
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm text-gray-400 text-xs px-2.5 py-1 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        AI quiz ready
      </div>
    );
  }
  return null;
}

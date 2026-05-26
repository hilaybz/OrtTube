"use client";

import { useEffect, useRef, useState } from "react";
import YouTube, { type YouTubeEvent, type YouTubePlayer } from "react-youtube";
import QuizModal from "@/components/QuizModal";
import type { QuizCheckpoint } from "@/lib/demoQuiz";

interface DBCheckpoint {
  id: string;
  position_seconds: number;
  label: string;
  questions: Array<{
    question: string;
    options: string[];
    correct: number;
    explanation: string;
  }>;
}

interface Props {
  videoId: string;
  checkpoints: DBCheckpoint[];
}

const POLL_MS = 500;

export default function StudentPlayer({ videoId, checkpoints }: Props) {
  const playerRef = useRef<YouTubePlayer | null>(null);
  const triggeredRef = useRef<Set<string>>(new Set());
  const [activeQuiz, setActiveQuiz] = useState<QuizCheckpoint | null>(null);

  useEffect(() => {
    triggeredRef.current.clear();
    setActiveQuiz(null);
  }, [videoId]);

  useEffect(() => {
    const interval = setInterval(() => {
      const player = playerRef.current;
      if (!player || activeQuiz) return;

      const currentTime: number = player.getCurrentTime();

      for (const cp of checkpoints) {
        if (
          currentTime >= cp.position_seconds &&
          !triggeredRef.current.has(cp.id)
        ) {
          triggeredRef.current.add(cp.id);
          player.pauseVideo();
          setActiveQuiz({
            percent: 0,
            label: cp.label,
            questions: cp.questions.map((q, i) => ({
              id: i,
              question: q.question,
              options: q.options,
              correct: q.correct,
              explanation: q.explanation,
            })),
          });
          break;
        }
      }
    }, POLL_MS);

    return () => clearInterval(interval);
  }, [activeQuiz, checkpoints]);

  function onReady(e: YouTubeEvent) {
    playerRef.current = e.target;
  }

  function handleComplete() {
    setActiveQuiz(null);
    playerRef.current?.playVideo();
  }

  return (
    <div className="relative w-full">
      <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
        <YouTube
          videoId={videoId}
          onReady={onReady}
          opts={{
            width: "100%",
            height: "100%",
            playerVars: { autoplay: 0, rel: 0, modestbranding: 1, fs: 1 },
          }}
          className="absolute inset-0 w-full h-full"
          iframeClassName="w-full h-full rounded-xl"
        />
      </div>

      {activeQuiz && (
        <QuizModal checkpoint={activeQuiz} onComplete={handleComplete} />
      )}
    </div>
  );
}

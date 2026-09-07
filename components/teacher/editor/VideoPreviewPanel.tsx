"use client";
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { VideoStage, type VideoStageHandle } from "@/components/video/VideoStage";
import { CheckpointTimeline, type TimelineMarker } from "@/components/video/CheckpointTimeline";
import { GlassCard } from "@/components/ui/GlassCard";
import type { AuthorQuestion } from "@/lib/quizAuthor";

export interface VideoPreviewPanelHandle {
  seekTo(seconds: number): void;
}

type MoveResult = boolean | void | Promise<boolean | void>;

export interface VideoPreviewPanelProps {
  youtubeVideoId: string;
  questions: AuthorQuestion[];
  activeQuestionId: string | null;
  onMarkerSelect: (question: AuthorQuestion) => void;
  onMarkerMove?: (questionId: string, seconds: number) => MoveResult;
  onClusterMove?: (questionIds: string[], seconds: number) => MoveResult;
  onProgress?: (current: number, duration: number) => void;
}

export const VideoPreviewPanel = forwardRef<VideoPreviewPanelHandle, VideoPreviewPanelProps>(
  function VideoPreviewPanel(
    {
      youtubeVideoId,
      questions,
      activeQuestionId,
      onMarkerSelect,
      onMarkerMove,
      onClusterMove,
      onProgress,
    },
    ref
  ) {
    const stageRef = useRef<VideoStageHandle>(null);
    const [duration, setDuration] = useState<number | null>(null);
    const [currentTime, setCurrentTime] = useState(0);

    useImperativeHandle(ref, () => ({
      seekTo: (s: number) => stageRef.current?.seekTo(s),
    }));

    const handleProgress = useCallback(
      (current: number, reportedDuration: number) => {
        setCurrentTime(current);
        // A duration of 0 means "not known yet" (player still booting) —
        // never regress an already-known duration back to unknown.
        if (reportedDuration > 0) setDuration(reportedDuration);
        onProgress?.(current, reportedDuration);
      },
      [onProgress]
    );

    const markers = useMemo<TimelineMarker[]>(
      () =>
        questions.map((q, i) => ({
          id: q.id,
          seconds: q.position_seconds,
          label: `שאלה ${i + 1}`,
        })),
      [questions]
    );

    // A question with no base-language prompt yet (translation row not
    // written) can't be resent through the question-upsert endpoint the
    // drag-drop save reuses — see `handleMarkerMove` in QuizEditor.tsx.
    const draggableIds = useMemo(
      () => new Set(questions.filter((q) => q.prompt != null).map((q) => q.id)),
      [questions]
    );

    const questionById = useMemo(
      () => new Map(questions.map((q) => [q.id, q] as const)),
      [questions]
    );

    return (
      <GlassCard className="flex shrink-0 flex-col gap-4">
        <VideoStage ref={stageRef} videoId={youtubeVideoId} maxSeek={null} onProgress={handleProgress} />
        <CheckpointTimeline
          durationSeconds={duration}
          currentSeconds={currentTime}
          markers={markers}
          activeMarkerId={activeQuestionId}
          onSeek={(seconds) => stageRef.current?.seekTo(seconds)}
          onMarkerClick={(id, seconds) => {
            stageRef.current?.seekTo(seconds);
            const q = questionById.get(id);
            if (q) onMarkerSelect(q);
          }}
          onMarkerMove={onMarkerMove}
          onClusterMove={onClusterMove}
          draggableIds={draggableIds}
        />
      </GlassCard>
    );
  }
);

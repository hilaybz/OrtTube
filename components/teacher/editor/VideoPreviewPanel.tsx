"use client";
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { VideoStage, type VideoStageHandle } from "@/components/video/VideoStage";
import { CheckpointTimeline, type TimelineMarker } from "@/components/video/CheckpointTimeline";
import { GlassCard } from "@/components/ui/GlassCard";
import type { AuthorQuestion } from "@/lib/quizAuthor";

export interface VideoPreviewPanelHandle {
  seekTo(seconds: number): void;
}

/** `false` reverts the drag immediately; `true`/`void` leaves it pinned at
 * the dropped spot until `questions` reports the new position (see
 * `CheckpointTimeline`'s own pending-move contract) — never a flicker back
 * to the old spot while the save + refresh is still in flight. */
type MoveResult = boolean | void | Promise<boolean | void>;

export interface VideoPreviewPanelProps {
  youtubeVideoId: string;
  /** Already time-sorted (`get_quiz_for_author`'s own order). */
  questions: AuthorQuestion[];
  activeQuestionId: string | null;
  onMarkerSelect: (question: AuthorQuestion) => void;
  /** Omit for a read-only panel (e.g. the quiz preview, backlog 1.3) — dragging
   * is then disabled entirely, same as `CheckpointTimeline`'s own contract. */
  onMarkerMove?: (questionId: string, seconds: number) => MoveResult;
  /** A whole cluster (2+ questions sharing a timestamp) dragged together — every id moves to the same new instant. Omit alongside `onMarkerMove` for read-only. */
  onClusterMove?: (questionIds: string[], seconds: number) => MoveResult;
  /** Bubbled up so the editor can also drive the "current time" prefill in `QuestionModal`. */
  onProgress?: (current: number, duration: number) => void;
}

/**
 * The editor's video preview: a free-seek player (`maxSeek={null}` — no
 * block-skip gating, unlike the student player) with a proportional
 * checkpoint timeline underneath. Duration is read from the player itself
 * once it reports one, never from `videos.duration_seconds` — that column is
 * null for most quizzes in production today (Epic 0's blocked transcript
 * scrape fetches it too), so depending on it would leave the timeline broken
 * for most real quizzes.
 */
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
      <GlassCard className="mb-6 flex shrink-0 flex-col gap-4">
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

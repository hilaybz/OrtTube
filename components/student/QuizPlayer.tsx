"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { Alert } from "@/components/ui/Alert";
import { apiFetch, ApiError } from "@/lib/http";
import { AskAI } from "./AskAI";
import type {
  StudentAttemptState,
  StudentQuiz,
  StudentQuestion,
  StartAttemptResult,
  AttemptSummary,
} from "@/lib/attempts";

const YouTube = dynamic(() => import("react-youtube"), { ssr: false });

interface YTPlayer {
  getCurrentTime(): number;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
}

function mmss(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Pure gate decision (Edpuzzle-style): a student may watch/rewind freely up to
 * the current unanswered checkpoint, but may not advance past it. Returns
 * whether the checkpoint is reached (show the question) and, if the playhead ran
 * past it, the position to snap back to. Exported for unit testing.
 */
export function gateDecision(
  playhead: number,
  gatePos: number | null
): { atGate: boolean; clampTo: number | null } {
  if (gatePos == null) return { atGate: false, clampTo: null };
  const clampTo = playhead > gatePos + 0.4 ? gatePos : null;
  const effective = clampTo != null ? gatePos : playhead;
  return { atGate: effective >= gatePos - 0.05, clampTo };
}

type Phase = "intro" | "playing" | "done";

export function QuizPlayer({
  classId,
  quizId,
  state,
}: {
  classId: string;
  quizId: string;
  state: StudentAttemptState;
}) {
  const router = useRouter();
  const resultsHref = `/student/quiz/${classId}/${quizId}/results`;

  const [phase, setPhase] = useState<Phase>("intro");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<StudentQuestion[]>([]);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [summary, setSummary] = useState<AttemptSummary | null>(null);

  const playerRef = useRef<YTPlayer | null>(null);

  const current = questions.find((q) => !answered.has(q.id)) ?? null;
  const allAnswered = questions.length > 0 && current === null;
  const gatePos = current?.position_seconds ?? null;
  const { atGate } = gateDecision(playhead, gatePos);

  // Poll the playhead: clamp any skip past the current checkpoint, and pause on
  // arrival so the question can gate progression.
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      let t: number;
      try {
        t = p.getCurrentTime?.() ?? 0;
      } catch {
        return;
      }
      if (typeof t !== "number" || Number.isNaN(t)) return;
      const { atGate: reached, clampTo } = gateDecision(t, gatePos);
      if (clampTo != null) {
        try {
          p.seekTo(clampTo, true);
        } catch {
          /* player mid-teardown */
        }
        t = clampTo;
      }
      if (reached) {
        try {
          p.pauseVideo();
        } catch {
          /* ignore */
        }
      }
      // Ignore spurious 0 readings (player not yet reporting) so an optimistic
      // jump/seek isn't yanked back to the start.
      const next = t;
      setPlayhead((prev) => (next === 0 && prev > 0 ? prev : next));
    }, 400);
    return () => clearInterval(id);
  }, [phase, gatePos]);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { attempt } = await apiFetch<{ attempt: StartAttemptResult }>(
        "/api/attempts",
        { method: "POST", body: JSON.stringify({ classId, quizId }) }
      );
      const { quiz } = await apiFetch<{ quiz: StudentQuiz }>(
        `/api/attempts/quiz?classId=${classId}&quizId=${quizId}`,
        { method: "GET" }
      );
      setAttemptId(attempt.attempt_id);
      setQuestions([...quiz.questions].sort((a, b) => a.order_index - b.order_index));
      setAnswered(new Set(attempt.answered_question_ids));
      setPhase("playing");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "לא ניתן להתחיל את החידון.");
    } finally {
      setBusy(false);
    }
  }, [classId, quizId]);

  /** Rewatch: seek back to the start of the current segment (previous checkpoint
   *  or the beginning) and resume — the overlay hides while the playhead is
   *  before the gate, and returns when the checkpoint is reached again. */
  function rewatch() {
    if (!current) return;
    const prev = questions
      .filter((q) => q.position_seconds < current.position_seconds)
      .reduce((m, q) => Math.max(m, q.position_seconds), 0);
    try {
      playerRef.current?.seekTo(prev, true);
      playerRef.current?.playVideo();
    } catch {
      /* ignore */
    }
    setPlayhead(prev);
  }

  /** Jump forward to the pending checkpoint (allowed — it's the gate, not past it). */
  function jumpToGate() {
    if (gatePos == null) return;
    try {
      playerRef.current?.seekTo(gatePos, true);
      playerRef.current?.pauseVideo();
    } catch {
      /* ignore */
    }
    setPlayhead(gatePos); // optimistic — reveals the question immediately
  }

  function toggleOption(optionId: string) {
    if (!current) return;
    setSelected((prev) =>
      current.kind === "single"
        ? [optionId]
        : prev.includes(optionId)
          ? prev.filter((o) => o !== optionId)
          : [...prev, optionId]
    );
  }

  const submit = useCallback(async () => {
    if (!current || !attemptId || selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/attempts/${attemptId}/answers`, {
        method: "POST",
        body: JSON.stringify({ questionId: current.id, optionIds: selected }),
      });
      setAnswered((prev) => new Set(prev).add(current.id));
      setSelected([]); // ready the next checkpoint's selection
      // The next gate is further ahead → the overlay hides; resume watching.
      try {
        playerRef.current?.playVideo();
      } catch {
        /* ignore */
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "לא ניתן לשמור את התשובה.");
    } finally {
      setBusy(false);
    }
  }, [current, attemptId, selected]);

  const finish = useCallback(async () => {
    if (!attemptId) return;
    setBusy(true);
    setError(null);
    try {
      const { summary: s } = await apiFetch<{ summary: AttemptSummary }>(
        `/api/attempts/${attemptId}/complete`,
        { method: "POST" }
      );
      setSummary(s);
      setPhase("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "לא ניתן לסיים את החידון.");
    } finally {
      setBusy(false);
    }
  }, [attemptId]);

  // ── INTRO ────────────────────────────────────────────────────────────────
  if (phase === "intro") {
    const noAttemptsLeft =
      state.attempts_left != null && state.attempts_left <= 0 && !state.in_progress;
    return (
      <div className="mx-auto max-w-2xl py-6">
        <GlassCard className="overflow-hidden p-0">
          <div className="aspect-video bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://i.ytimg.com/vi/${state.youtube_video_id}/hqdefault.jpg`}
              alt=""
              className="h-full w-full object-cover opacity-90"
            />
          </div>
          <div className="flex flex-col gap-4 p-6">
            <h1 className="text-2xl font-bold">{state.video_title ?? "חידון"}</h1>
            <p className="text-sm text-[var(--body)]">
              {state.max_attempts == null
                ? "ניסיונות ללא הגבלה"
                : `נותרו ${state.attempts_left} מתוך ${state.max_attempts} ניסיונות`}
            </p>
            {error && <Alert variant="danger">{error}</Alert>}
            {noAttemptsLeft ? (
              <Button size="lg" onClick={() => router.push(resultsHref)}>
                צפייה בתוצאות
              </Button>
            ) : (
              <Button size="lg" onClick={start} disabled={busy}>
                {busy ? <Spinner size={18} /> : state.in_progress ? "המשך החידון" : "התחלה"}
              </Button>
            )}
          </div>
        </GlassCard>
      </div>
    );
  }

  // ── DONE ─────────────────────────────────────────────────────────────────
  if (phase === "done" && summary) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <GlassCard className="flex flex-col items-center gap-4 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-[var(--brand-softer)]">
            <Icon name="check" size={30} label="הושלם" className="text-[var(--fg-brand)]" />
          </span>
          <h1 className="text-2xl font-bold">סיימת את החידון!</h1>
          <p className="text-lg text-[var(--body)]">
            ענית נכון על{" "}
            <b className="text-[var(--heading)]">
              {summary.num_correct}/{summary.num_questions}
            </b>{" "}
            שאלות
          </p>
          <Button size="lg" onClick={() => router.push(resultsHref)} className="mt-2">
            צפייה בסיכום
          </Button>
        </GlassCard>
      </div>
    );
  }

  // ── PLAYING ──────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3 py-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-[var(--body)]">
          {answered.size} / {questions.length} שאלות
        </span>
        <AskAI
          classId={classId}
          quizId={quizId}
          tutorMode={state.tutor_mode}
          context={{
            positionSeconds: playhead,
            attemptId,
            activeQuestionId: current?.id ?? null,
          }}
        />
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {/* Video stage with the question overlaid on the paused frame. */}
      <div className="relative overflow-hidden rounded-[var(--radius)] border border-[var(--glass-border)] bg-black">
        <div className="aspect-video">
          <YouTube
            videoId={state.youtube_video_id}
            className="h-full w-full"
            iframeClassName="h-full w-full"
            opts={{ width: "100%", height: "100%", playerVars: { rel: 0, modestbranding: 1 } }}
            onReady={(e: { target: YTPlayer }) => {
              playerRef.current = e.target;
            }}
          />
        </div>

        {current && atGate && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
            <div className="quiz-pop glass w-full max-w-lg p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--fg-brand)]">
                  נקודת עצירה · {mmss(current.position_seconds)}
                  {current.kind === "multi" && (
                    <Badge variant="gray" pill>
                      בחירה מרובה
                    </Badge>
                  )}
                </span>
                <button
                  type="button"
                  onClick={rewatch}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--body)] hover:text-[var(--heading)]"
                >
                  <Icon name="arrow" size={14} /> צפייה חוזרת בקטע
                </button>
              </div>
              <h2 className="mb-4 text-lg font-semibold leading-snug">{current.prompt}</h2>
              <div className="mb-4 flex flex-col gap-2.5">
                {current.options.map((o, i) => {
                  const active = selected.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggleOption(o.id)}
                      aria-pressed={active}
                      className={cn(
                        "flex items-center gap-3 rounded-[var(--radius-d)] border p-3.5 text-start text-sm transition-colors",
                        active
                          ? "border-[var(--brand)] bg-[var(--brand-softer)] text-[var(--fg-brand-strong)]"
                          : "border-[var(--glass-border)] bg-white/50 hover:bg-white/70"
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-6 w-6 flex-none place-items-center rounded-md border text-xs font-bold",
                          active
                            ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                            : "border-[var(--glass-border)] text-[var(--body)]"
                        )}
                      >
                        {active ? "✓" : ("אבגדה"[i] ?? String(i + 1))}
                      </span>
                      <span>{o.text}</span>
                    </button>
                  );
                })}
              </div>
              <Button onClick={submit} disabled={busy || selected.length === 0} className="w-full">
                {busy ? <Spinner size={18} /> : "שליחת תשובה"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Checkpoint scrubber */}
      <CheckpointBar
        duration={state.duration_seconds ?? 0}
        questions={questions}
        answered={answered}
        playhead={playhead}
      />

      {/* Controls / gate hint */}
      {current && !atGate && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-[var(--body)]">
            נקודת העצירה הבאה בדקה {mmss(current.position_seconds)} — צפו עד לשם כדי לענות.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => playerRef.current?.playVideo()}>
              <Icon name="play" size={16} /> המשך צפייה
            </Button>
            <Button variant="ghost" onClick={jumpToGate}>
              מעבר לנקודת העצירה
            </Button>
          </div>
        </div>
      )}

      {allAnswered && (
        <GlassCard className="flex flex-col items-center gap-3 text-center">
          <h2 className="text-lg font-semibold">ענית על כל השאלות 🎉</h2>
          <Button size="lg" onClick={finish} disabled={busy}>
            {busy ? <Spinner size={18} /> : "סיום החידון"}
          </Button>
        </GlassCard>
      )}
    </div>
  );
}

function CheckpointBar({
  duration,
  questions,
  answered,
  playhead,
}: {
  duration: number;
  questions: StudentQuestion[];
  answered: Set<string>;
  playhead: number;
}) {
  const pct = duration > 0 ? Math.min(100, (playhead / duration) * 100) : 0;
  const currentId = questions.find((q) => !answered.has(q.id))?.id;
  return (
    // Video timelines read left→right even in an RTL app — match YouTube's bar.
    <div dir="ltr" className="relative h-3 rounded-full bg-white/50">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-[var(--brand)]"
        style={{ width: `${pct}%` }}
      />
      {duration > 0 &&
        questions.map((q) => {
          const left = Math.min(100, (q.position_seconds / duration) * 100);
          const done = answered.has(q.id);
          const isCurrent = q.id === currentId;
          return (
            <span
              key={q.id}
              title={mmss(q.position_seconds)}
              className={cn(
                "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-white",
                done
                  ? "bg-[var(--brand)]"
                  : isCurrent
                    ? "bg-[var(--fg-brand)] ring-2 ring-[var(--brand-soft)]"
                    : "bg-[var(--gray)]"
              )}
              style={{ insetInlineStart: `calc(${left}% - 7px)` }}
            />
          );
        })}
    </div>
  );
}

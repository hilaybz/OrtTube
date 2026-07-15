"use client";
import { Fragment, useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { Alert } from "@/components/ui/Alert";
import { apiFetch, ApiError } from "@/lib/http";
import { gateDecision } from "./gate";
import { AskAI } from "./AskAI";
import { VideoStage, type VideoStageHandle } from "./VideoStage";
import type {
  StudentAttemptState,
  StudentQuiz,
  StudentQuestion,
  StartAttemptResult,
  AttemptSummary,
} from "@/lib/attempts";

function mmss(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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

  const stageRef = useRef<VideoStageHandle>(null);
  // Stable so VideoStage's poll effect isn't torn down/recreated every render.
  const onProgress = useCallback((c: number) => setPlayhead(c), []);

  const current = questions.find((q) => !answered.has(q.id)) ?? null;
  const allAnswered = questions.length > 0 && current === null;
  const gatePos = current?.position_seconds ?? null;
  const { atGate } = gateDecision(playhead, gatePos);

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

  function rewatch() {
    if (!current) return;
    const prev = questions
      .filter((q) => q.position_seconds < current.position_seconds)
      .reduce((m, q) => Math.max(m, q.position_seconds), 0);
    stageRef.current?.seekTo(prev);
    setPlayhead(prev);
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
      setSelected([]);
      // The gate advances → VideoStage auto-resumes toward the next checkpoint.
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
  const markers = questions.map((q, i) => ({
    seconds: q.position_seconds,
    done: answered.has(q.id),
    current: q.id === current?.id,
    index: i,
  }));

  const overlay =
    current && atGate ? (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
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
    ) : null;

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

      <VideoStage
        ref={stageRef}
        videoId={state.youtube_video_id}
        maxSeek={gatePos}
        overlay={overlay}
        onProgress={onProgress}
      />

      <CheckpointStepper
        markers={markers}
        onSeek={(s) => stageRef.current?.seekTo(s)}
      />

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

interface RailMarker {
  seconds: number;
  done: boolean;
  current: boolean;
  index: number;
}

/**
 * The quiz-checkpoint stepper below the player. Numbered nodes in QUESTION order
 * (not time position, so they never cluster on a long video), connected by a
 * progress line — done ✓, the current one ringed + clickable ("jump to it"),
 * upcoming ones locked. A caption shows when the next checkpoint is.
 */
function CheckpointStepper({
  markers,
  onSeek,
}: {
  markers: RailMarker[];
  onSeek: (seconds: number) => void;
}) {
  if (markers.length === 0) return null;
  const currentSeconds = markers.find((m) => m.current)?.seconds ?? null;
  return (
    <div className="rounded-[var(--radius)] border border-[var(--glass-border)] bg-white/50 px-5 py-4">
      <div className="flex items-center">
        {markers.map((m, i) => {
          const locked = !m.done && !m.current;
          return (
            <Fragment key={m.seconds}>
              {i > 0 && (
                <div
                  className={cn(
                    "h-0.5 flex-1",
                    markers[i - 1].done
                      ? "bg-[var(--brand)]"
                      : "bg-[var(--neutral-quaternary)]"
                  )}
                />
              )}
              <button
                type="button"
                disabled={locked}
                title={mmss(m.seconds)}
                aria-label={m.current ? "מעבר לנקודת העצירה" : `שאלה ${m.index + 1}`}
                onClick={() => {
                  if (!locked) onSeek(m.seconds);
                }}
                className={cn(
                  "grid h-7 w-7 flex-none place-items-center rounded-full border-2 text-xs font-bold transition",
                  m.done
                    ? "cursor-pointer border-[var(--brand)] bg-[var(--brand)] text-white"
                    : m.current
                      ? "cursor-pointer border-[var(--brand)] bg-white text-[var(--fg-brand)] ring-4 ring-[var(--brand-softer)]"
                      : "cursor-not-allowed border-[var(--neutral-quaternary)] bg-white text-[var(--body-subtle)]"
                )}
              >
                {m.done ? "✓" : m.index + 1}
              </button>
            </Fragment>
          );
        })}
      </div>
      <p className="mt-3 text-center text-xs font-medium text-[var(--fg-brand-strong)]">
        {currentSeconds != null
          ? `השאלה הבאה · ${mmss(currentSeconds)}`
          : "כל השאלות נענו 🎉"}
      </p>
    </div>
  );
}


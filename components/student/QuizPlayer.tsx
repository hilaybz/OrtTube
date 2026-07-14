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
  const [revealed, setRevealed] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [summary, setSummary] = useState<AttemptSummary | null>(null);

  const playerRef = useRef<YTPlayer | null>(null);

  const current = questions.find((q) => !answered.has(q.id)) ?? null;
  const allAnswered = questions.length > 0 && current === null;

  // Reset per-question UI when the active checkpoint changes.
  useEffect(() => {
    setSelected([]);
    setRevealed(false);
  }, [current?.id]);

  // Poll the playhead; auto-pause + reveal when we reach the current checkpoint.
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      const t = p.getCurrentTime?.() ?? 0;
      setPlayhead(t);
      if (current && !revealed && t >= current.position_seconds) {
        p.pauseVideo();
        setRevealed(true);
      }
    }, 500);
    return () => clearInterval(id);
  }, [phase, current, revealed]);

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
      const sorted = [...quiz.questions].sort(
        (a, b) => a.order_index - b.order_index
      );
      setAttemptId(attempt.attempt_id);
      setQuestions(sorted);
      setAnswered(new Set(attempt.answered_question_ids));
      setPhase("playing");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "לא ניתן להתחיל את החידון.");
    } finally {
      setBusy(false);
    }
  }, [classId, quizId]);

  function toggleOption(optionId: string) {
    if (!current) return;
    setSelected((prev) => {
      if (current.kind === "single") return [optionId];
      return prev.includes(optionId)
        ? prev.filter((o) => o !== optionId)
        : [...prev, optionId];
    });
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
      // Resume playback toward the next checkpoint.
      playerRef.current?.playVideo();
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

  // ── INTRO ───────────────────────────────────────────────────────────────
  if (phase === "intro") {
    const noAttemptsLeft =
      state.attempts_left != null &&
      state.attempts_left <= 0 &&
      !state.in_progress;
    return (
      <div className="mx-auto max-w-2xl py-6">
        <GlassCard className="p-0 overflow-hidden">
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

  // ── DONE ────────────────────────────────────────────────────────────────
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

  // ── PLAYING ─────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto grid max-w-6xl gap-5 py-4 lg:grid-cols-[1.5fr_1fr]">
      <div className="flex flex-col gap-3">
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--glass-border)] bg-black">
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
        </div>
        <CheckpointBar
          duration={state.duration_seconds ?? 0}
          questions={questions}
          answered={answered}
          playhead={playhead}
        />
      </div>

      <aside className="flex flex-col">
        {error && <Alert variant="danger" className="mb-3">{error}</Alert>}
        {current ? (
          <GlassCard className="flex flex-col gap-4">
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--fg-brand)]">
              נקודת עצירה · {mmss(current.position_seconds)}
              {current.kind === "multi" && (
                <Badge variant="gray" pill>
                  בחירה מרובה
                </Badge>
              )}
            </span>

            {revealed ? (
              <>
                <h2 className="text-lg font-semibold leading-snug">{current.prompt}</h2>
                <div className="flex flex-col gap-2.5">
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
                            : "border-[var(--glass-border)] bg-white/40 hover:bg-white/60"
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
                          {active ? "✓" : "אבגדהוזחט"[i] ?? i + 1}
                        </span>
                        <span>{o.text}</span>
                      </button>
                    );
                  })}
                </div>
                <Button onClick={submit} disabled={busy || selected.length === 0}>
                  {busy ? <Spinner size={18} /> : "שליחת תשובה"}
                </Button>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold leading-snug">
                  צפו בסרטון עד לנקודת העצירה ({mmss(current.position_seconds)}) כדי לענות.
                </h2>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      playerRef.current?.playVideo();
                    }}
                  >
                    <Icon name="play" size={16} /> המשך צפייה
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      playerRef.current?.pauseVideo();
                      setRevealed(true);
                    }}
                  >
                    כבר צפיתי — הצגת השאלה
                  </Button>
                </div>
              </div>
            )}
          </GlassCard>
        ) : (
          <GlassCard className="flex flex-col items-center gap-4 text-center">
            <h2 className="text-lg font-semibold">ענית על כל השאלות 🎉</h2>
            <p className="text-sm text-[var(--body)]">
              אפשר לסיים את החידון ולראות את הסיכום.
            </p>
            <Button size="lg" onClick={finish} disabled={busy}>
              {busy ? <Spinner size={18} /> : "סיום החידון"}
            </Button>
          </GlassCard>
        )}
        <p className="mt-3 text-center text-xs text-[var(--body-subtle)]">
          {answered.size} מתוך {questions.length} שאלות נענו
          {allAnswered ? "" : ` · ${mmss(playhead)}`}
        </p>
      </aside>
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
  return (
    <div className="relative h-3 rounded-full bg-white/50">
      <div
        className="absolute inset-y-0 start-0 rounded-full bg-[var(--brand)]"
        style={{ width: `${pct}%` }}
      />
      {duration > 0 &&
        questions.map((q) => {
          const left = Math.min(100, (q.position_seconds / duration) * 100);
          const done = answered.has(q.id);
          return (
            <span
              key={q.id}
              title={`${q.position_seconds}s`}
              className={cn(
                "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-white",
                done ? "bg-[var(--brand)]" : "bg-[var(--gray)]"
              )}
              style={{ insetInlineStart: `calc(${left}% - 7px)` }}
            />
          );
        })}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import YouTube, { type YouTubeEvent, type YouTubePlayer } from "react-youtube";
import QuizModal from "@/components/QuizModal";
import AskAI from "@/components/AskAI";
import { createClient } from "@/lib/supabase/client";

interface DBQuestion {
  id: string;
  question: string;
  options: string[];
  correct: number;
  explanation: string;
}

interface DBCheckpoint {
  id: string;
  position_seconds: number;
  label: string;
  questions: DBQuestion[];
}

interface Props {
  videoUuid: string;
  videoId: string;
  summary: string | null;
  checkpoints: DBCheckpoint[];
  /** Set when this student already completed the quizzes for this video —
   * they can rewatch, but questions won't fire again. */
  previousResult: { score: number | null; total: number | null } | null;
  /** Set when this student has an unfinished attempt — its session is
   * reused, already-answered questions are skipped, and the score carries. */
  resume: {
    sessionId: string;
    answeredQuestionIds: string[];
    correctCount: number;
  } | null;
}

const POLL_MS = 500;
const YT_STATE_ENDED = 0;
const YT_STATE_PLAYING = 1;

function fmtSec(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function StudentPlayer({
  videoUuid,
  videoId,
  summary,
  checkpoints,
  previousResult,
  resume,
}: Props) {
  // One supabase instance for this mount — avoids any auth-state drift
  // between multiple createClient() calls.
  const supabase = useMemo(() => createClient(), []);

  const playerRef = useRef<YouTubePlayer | null>(null);
  const triggeredRef = useRef<Set<string>>(new Set());
  const activeCpRef = useRef<DBCheckpoint | null>(null);
  const sessionInitRef = useRef(false);
  const completedRef = useRef(false);
  const correctCountRef = useRef(0);
  const answeredCountRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);

  const [activeCheckpoint, setActiveCheckpoint] = useState<DBCheckpoint | null>(null);
  const [passedCpIds, setPassedCpIds] = useState<Set<string>>(new Set());
  const [videoEnded, setVideoEnded] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [askOpen, setAskOpen] = useState(false);
  const [hasAccount, setHasAccount] = useState(false);

  const totalQuestions = checkpoints.reduce((s, cp) => s + cp.questions.length, 0);

  // Resume support: strip questions the student already answered; a
  // checkpoint with nothing left to ask is treated as already passed.
  const answeredIds = useMemo(
    () => new Set(resume?.answeredQuestionIds ?? []),
    [resume]
  );
  const effectiveCheckpoints = useMemo(
    () =>
      checkpoints.map((cp) => ({
        ...cp,
        questions: cp.questions.filter((q) => !answeredIds.has(q.id)),
      })),
    [checkpoints, answeredIds]
  );
  const donePositions = effectiveCheckpoints
    .filter((cp, i) => cp.questions.length === 0 && checkpoints[i].questions.length > 0)
    .map((cp) => cp.position_seconds);
  // Start playback just after the last fully-answered checkpoint.
  const startSeconds = donePositions.length > 0 ? Math.max(...donePositions) : 0;

  useEffect(() => {
    activeCpRef.current = activeCheckpoint;
  }, [activeCheckpoint]);

  // Drop the player handle on unmount so stale timers/callbacks from a
  // back/forward navigation can't call into a destroyed YouTube widget.
  useEffect(() => {
    return () => {
      playerRef.current = null;
    };
  }, []);

  // Start the session: anonymous sign-in + insert a student_sessions row.
  // sessionInitRef guards against React strict-mode double-invocation.
  // When the student already completed this video, no new session is
  // tracked — it's a free rewatch.
  useEffect(() => {
    if (sessionInitRef.current) return;
    sessionInitRef.current = true;

    (async () => {
      if (previousResult) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        setHasAccount(Boolean(user?.email));
        return;
      }

      let {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) {
          console.error("[student] anonymous sign-in failed:", error);
          return;
        }
        if (!data.user) return;
        user = data.user;
      }
      setHasAccount(Boolean(user.email));

      if (resume) {
        // Continue the unfinished attempt: same session, carried score.
        sessionIdRef.current = resume.sessionId;
        answeredCountRef.current = resume.answeredQuestionIds.length;
        correctCountRef.current = resume.correctCount;
        console.log(
          `[student] resuming session ${resume.sessionId} (${resume.answeredQuestionIds.length}/${totalQuestions} answered)`
        );
        return;
      }

      const studentName =
        (user.user_metadata?.display_name as string | undefined) ?? null;
      const { data: session, error } = await supabase
        .from("student_sessions")
        .insert({
          video_id: videoUuid,
          supabase_user_id: user.id,
          student_name: studentName,
          total_questions: totalQuestions,
        })
        .select("id")
        .single();
      if (error) {
        console.error("[student] session insert failed:", error);
        return;
      }
      if (session) {
        sessionIdRef.current = session.id;
        console.log("[student] session started:", session.id);
      }
    })();
  }, [supabase, videoUuid, totalQuestions, previousResult, resume]);

  useEffect(() => {
    triggeredRef.current.clear();
    // Fully-answered checkpoints never fire again. Checkpoints that never
    // had questions (teacher hasn't added any) are excluded so they don't
    // show as "passed" — the trigger loop skips them instead.
    for (let i = 0; i < effectiveCheckpoints.length; i++) {
      if (
        effectiveCheckpoints[i].questions.length === 0 &&
        checkpoints[i].questions.length > 0
      ) {
        triggeredRef.current.add(effectiveCheckpoints[i].id);
      }
    }
    setPassedCpIds(new Set(triggeredRef.current));
    setActiveCheckpoint(null);
    // effectiveCheckpoints is derived from props that only change with the
    // video, so videoId is the real reset trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  useEffect(() => {
    if (previousResult) return; // quizzes only fire on the first attempt
    const interval = setInterval(() => {
      const player = playerRef.current;
      if (!player || activeCheckpoint) return;

      // The widget can be mid-teardown during back/forward navigation —
      // treat any player API failure as "no reading this tick".
      let currentTime: number;
      try {
        currentTime = player.getCurrentTime();
      } catch {
        return;
      }
      if (typeof currentTime !== "number" || Number.isNaN(currentTime)) return;

      for (const cp of effectiveCheckpoints) {
        if (cp.questions.length === 0) continue; // nothing to ask
        if (
          currentTime >= cp.position_seconds &&
          !triggeredRef.current.has(cp.id)
        ) {
          triggeredRef.current.add(cp.id);
          setPassedCpIds(new Set(triggeredRef.current));
          try {
            player.pauseVideo();
          } catch {
            // player already destroyed — the quiz modal still opens
          }
          setActiveCheckpoint(cp);
          break;
        }
      }
    }, POLL_MS);

    return () => clearInterval(interval);
  }, [activeCheckpoint, effectiveCheckpoints, previousResult]);

  // DB-only completion — the finish overlay is driven separately by the
  // video actually ending, so answering the last quiz early doesn't
  // interrupt the remaining minutes of the lesson.
  async function markComplete() {
    const sid = sessionIdRef.current;
    if (!sid || completedRef.current) return;
    completedRef.current = true;
    const { error } = await supabase
      .from("student_sessions")
      .update({
        completed_at: new Date().toISOString(),
        final_score: correctCountRef.current,
      })
      .eq("id", sid);
    if (error) {
      console.error("[student] session complete update failed:", error);
      completedRef.current = false; // allow retry
    } else {
      console.log(
        `[student] session completed: ${correctCountRef.current}/${totalQuestions}`
      );
    }
  }

  function onReady(e: YouTubeEvent) {
    playerRef.current = e.target;
  }

  function onStateChange(e: YouTubeEvent) {
    if (activeCpRef.current && e.data === YT_STATE_PLAYING) {
      e.target.pauseVideo();
      return;
    }
    if (e.data === YT_STATE_ENDED) {
      if (!previousResult) {
        setFinalScore(correctCountRef.current);
        setVideoEnded(true);
        void markComplete();
      }
    }
  }

  async function logEvent(
    eventType: "confusion" | "ask_ai",
    fields: { video_timestamp_seconds?: number | null; query?: string; response?: string }
  ) {
    const sid = sessionIdRef.current;
    if (!sid) {
      console.warn(`[student] ${eventType} dropped — no session yet`);
      return;
    }
    const { error } = await supabase.from("student_events").insert({
      session_id: sid,
      event_type: eventType,
      video_timestamp_seconds: fields.video_timestamp_seconds ?? null,
      query: fields.query ?? null,
      response: fields.response ?? null,
    });
    if (error) {
      console.error(`[student] ${eventType} event insert failed:`, error);
    }
  }

  function handleAskAi(query: string, response: string) {
    const ts = Math.round(playerRef.current?.getCurrentTime() ?? 0);
    void logEvent("ask_ai", { video_timestamp_seconds: ts, query, response });
  }

  function toggleAskPanel() {
    setAskOpen((open) => {
      if (!open) playerRef.current?.pauseVideo();
      return !open;
    });
  }

  async function recordAnswer(
    cp: DBCheckpoint,
    questionIndex: number,
    selectedIndex: number,
    isCorrect: boolean
  ) {
    answeredCountRef.current += 1;
    if (isCorrect) correctCountRef.current += 1;

    const sid = sessionIdRef.current;
    if (!sid) {
      console.warn("[student] answer dropped — no session yet");
      return;
    }
    const dbQuestion = cp.questions[questionIndex];
    if (!dbQuestion) return;

    const { error } = await supabase.from("student_answers").insert({
      session_id: sid,
      question_id: dbQuestion.id,
      selected_index: selectedIndex,
      is_correct: isCorrect,
    });
    if (error) {
      console.error("[student] answer insert failed:", error);
    }

    // Mark complete after the last question is answered, so finishing
    // every quiz counts as "completed" even if the student closes the
    // tab before the video ends.
    if (answeredCountRef.current >= totalQuestions && totalQuestions > 0) {
      void markComplete();
    }
  }

  function handleQuizComplete() {
    setActiveCheckpoint(null);
    try {
      playerRef.current?.playVideo();
    } catch {
      // player torn down mid-navigation — nothing to resume
    }
  }

  let videoTimestamp = 0;
  try {
    videoTimestamp = Math.round(playerRef.current?.getCurrentTime?.() ?? 0);
  } catch {
    // player not ready / already destroyed
  }

  return (
    <div className="w-full space-y-4">
      {/* Already-completed banner (rewatch mode) */}
      {previousResult && (
        <div className="flex flex-wrap items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-sm text-green-400">
          <span>✓</span>
          <span>
            כבר השלמתם את השאלות בשיעור הזה
            {previousResult.score !== null && previousResult.total
              ? ` — הציון שלכם ${previousResult.score}/${previousResult.total}`
              : ""}
            . אפשר לצפות שוב בחופשיות.
          </span>
        </div>
      )}

      {/* Resume banner */}
      {!previousResult && resume && resume.answeredQuestionIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3 text-sm text-blue-400">
          <span>↻</span>
          <span>
            ממשיכים מהנקודה שבה עצרתם — כבר עניתם על{" "}
            {resume.answeredQuestionIds.length} מתוך {totalQuestions} שאלות.
          </span>
        </div>
      )}

      {/* Player */}
      <div className="rounded-xl overflow-hidden border border-gray-800 shadow-2xl">
        <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
          <YouTube
            videoId={videoId}
            onReady={onReady}
            onStateChange={onStateChange}
            opts={{
              width: "100%",
              height: "100%",
              playerVars: {
                autoplay: 0,
                rel: 0,
                modestbranding: 1,
                fs: 1,
                start: startSeconds,
              },
            }}
            className="absolute inset-0 w-full h-full"
            iframeClassName="w-full h-full"
          />
        </div>
      </div>

      {/* Checkpoint progress strip */}
      {checkpoints.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {checkpoints.map((cp) => {
            const passed = Boolean(previousResult) || passedCpIds.has(cp.id);
            return (
              <span
                key={cp.id}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                  passed
                    ? "bg-green-500/10 border-green-500/30 text-green-400"
                    : "bg-[#161920] border-gray-800 text-gray-500"
                }`}
              >
                <span className="font-mono" dir="ltr">
                  {fmtSec(cp.position_seconds)}
                </span>
                {passed ? "✓" : "•"}
                <span dir="auto" className="max-w-40 truncate">
                  {cp.label}
                </span>
              </span>
            );
          })}
        </div>
      )}

      {/* Ask AI during the video */}
      <div className="bg-[#161920] border border-gray-800 rounded-xl px-4 py-3">
        <button
          onClick={toggleAskPanel}
          className="w-full flex items-center justify-between text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          <span className="flex items-center gap-2">
            <span>✦</span> יש לכם שאלה על השיעור? שאלו את ה-AI
          </span>
          <span className="text-gray-600 text-xs">{askOpen ? "▲" : "▼"}</span>
        </button>
        {askOpen && (
          <AskAI
            videoSummary={summary ?? undefined}
            currentTimeSeconds={videoTimestamp}
            onAsked={handleAskAi}
            startOpen
          />
        )}
      </div>

      {/* Quiz modal */}
      {activeCheckpoint && (
        <QuizModal
          checkpoint={{
            percent: 0,
            label: activeCheckpoint.label,
            questions: activeCheckpoint.questions.map((q, i) => ({
              id: i,
              question: q.question,
              options: q.options,
              correct: q.correct,
              explanation: q.explanation,
            })),
          }}
          videoSummary={summary ?? undefined}
          currentTimeSeconds={activeCheckpoint.position_seconds}
          onAnswer={(qIndex, selected, isCorrect) =>
            void recordAnswer(activeCheckpoint, qIndex, selected, isCorrect)
          }
          onAskAi={handleAskAi}
          onComplete={handleQuizComplete}
        />
      )}

      {/* Finish screen — only when the video itself has ended */}
      {videoEnded && !activeCheckpoint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4 py-6">
          <div className="w-full max-w-sm max-h-[85dvh] overflow-y-auto bg-[#161920] border border-gray-700 rounded-2xl shadow-2xl p-8 text-center space-y-4 animate-modal-in">
            <p className="text-4xl">🎉</p>
            <h3 className="text-white text-xl font-bold">סיימתם את השיעור!</h3>
            {totalQuestions > 0 ? (
              <>
                <div
                  className={`mx-auto w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold border-4 ${
                    finalScore === totalQuestions
                      ? "border-green-500 text-green-400"
                      : finalScore >= totalQuestions / 2
                      ? "border-blue-500 text-blue-400"
                      : "border-yellow-500 text-yellow-400"
                  }`}
                >
                  {finalScore}/{totalQuestions}
                </div>
                <p className="text-gray-400 text-sm">
                  {finalScore === totalQuestions
                    ? "ציון מושלם — כל הכבוד!"
                    : finalScore >= totalQuestions / 2
                    ? "עבודה יפה!"
                    : "לא נורא — למדתם משהו חדש."}
                </p>
              </>
            ) : (
              <p className="text-gray-400 text-sm">תודה שצפיתם עד הסוף.</p>
            )}

            <div className="text-start">
              <AskAI
                videoSummary={summary ?? undefined}
                currentTimeSeconds={videoTimestamp}
                onAsked={handleAskAi}
                triggerLabel="יש לכם עוד שאלה על השיעור? שאלו את ה-AI"
              />
            </div>

            {hasAccount ? (
              <a
                href="/student"
                className="block w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium py-3 rounded-xl transition-colors"
              >
                סגירת המשימה וחזרה לשיעורים
              </a>
            ) : (
              <button
                onClick={() => setVideoEnded(false)}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium py-3 rounded-xl transition-colors"
              >
                סגירת המשימה
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

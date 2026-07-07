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
}

const POLL_MS = 500;
const YT_STATE_ENDED = 0;
const YT_STATE_PLAYING = 1;

function fmtSec(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function StudentPlayer({ videoUuid, videoId, summary, checkpoints }: Props) {
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
  const [finished, setFinished] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [askOpen, setAskOpen] = useState(false);

  const totalQuestions = checkpoints.reduce((s, cp) => s + cp.questions.length, 0);

  useEffect(() => {
    activeCpRef.current = activeCheckpoint;
  }, [activeCheckpoint]);

  // Start the session: anonymous sign-in + insert a student_sessions row.
  // sessionInitRef guards against React strict-mode double-invocation.
  useEffect(() => {
    if (sessionInitRef.current) return;
    sessionInitRef.current = true;

    (async () => {
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
      const { data: session, error } = await supabase
        .from("student_sessions")
        .insert({
          video_id: videoUuid,
          supabase_user_id: user.id,
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
  }, [supabase, videoUuid, totalQuestions]);

  useEffect(() => {
    triggeredRef.current.clear();
    setPassedCpIds(new Set());
    setActiveCheckpoint(null);
  }, [videoId]);

  useEffect(() => {
    const interval = setInterval(() => {
      const player = playerRef.current;
      if (!player || activeCheckpoint) return;

      const currentTime: number = player.getCurrentTime();

      for (const cp of checkpoints) {
        if (
          currentTime >= cp.position_seconds &&
          !triggeredRef.current.has(cp.id)
        ) {
          triggeredRef.current.add(cp.id);
          setPassedCpIds(new Set(triggeredRef.current));
          player.pauseVideo();
          setActiveCheckpoint(cp);
          break;
        }
      }
    }, POLL_MS);

    return () => clearInterval(interval);
  }, [activeCheckpoint, checkpoints]);

  async function markComplete() {
    const sid = sessionIdRef.current;
    if (!sid || completedRef.current) return;
    completedRef.current = true;
    setFinalScore(correctCountRef.current);
    setFinished(true);
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
      void markComplete();
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
    playerRef.current?.playVideo();
  }

  const videoTimestamp = Math.round(playerRef.current?.getCurrentTime?.() ?? 0);

  return (
    <div className="w-full space-y-4">
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
              playerVars: { autoplay: 0, rel: 0, modestbranding: 1, fs: 1 },
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
            const passed = passedCpIds.has(cp.id);
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

      {/* Finish screen */}
      {finished && !activeCheckpoint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm bg-[#161920] border border-gray-700 rounded-2xl shadow-2xl p-8 text-center space-y-4 animate-modal-in">
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
                    ? "עבודה יפה! אפשר לצפות שוב כדי להשתפר."
                    : "שווה לצפות בסרטון שוב ולנסות שנית."}
                </p>
              </>
            ) : (
              <p className="text-gray-400 text-sm">תודה שצפיתם עד הסוף.</p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium py-3 rounded-xl transition-colors"
            >
              צפייה חוזרת
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

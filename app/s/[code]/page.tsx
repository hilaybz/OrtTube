import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import StudentPlayer from "./StudentPlayer";

interface Props {
  params: Promise<{ code: string }>;
}

function fmtSec(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default async function SharePage({ params }: Props) {
  const { code } = await params;
  const supabase = await createClient();

  const { data: video } = await supabase
    .from("videos")
    .select("id, youtube_video_id, title")
    .eq("share_code", code)
    .single();

  if (!video) redirect("/");

  // One attempt per student: if this user already completed the quizzes
  // for this video, they can rewatch but the questions won't fire again.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: completedSession } = user
    ? await supabase
        .from("student_sessions")
        .select("final_score, total_questions")
        .eq("video_id", video.id)
        .eq("supabase_user_id", user.id)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  // Partial attempt: reuse the latest unfinished session so the student
  // continues where they stopped instead of starting over.
  const { data: partialSession } =
    user && !completedSession
      ? await supabase
          .from("student_sessions")
          .select("id")
          .eq("video_id", video.id)
          .eq("supabase_user_id", user.id)
          .is("completed_at", null)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

  let resume: {
    sessionId: string;
    answeredQuestionIds: string[];
    correctCount: number;
  } | null = null;
  if (partialSession) {
    const { data: prevAnswers } = await supabase
      .from("student_answers")
      .select("question_id, is_correct")
      .eq("session_id", partialSession.id);
    resume = {
      sessionId: partialSession.id,
      answeredQuestionIds: (prevAnswers ?? []).map((a) => a.question_id),
      correctCount: (prevAnswers ?? []).filter((a) => a.is_correct).length,
    };
  }

  const { data: transcriptRow } = await supabase
    .from("youtube_transcripts")
    .select("summary")
    .eq("youtube_video_id", video.youtube_video_id)
    .maybeSingle();

  const { data: cps } = await supabase
    .from("quiz_checkpoints")
    .select("id, position_seconds, label, order_index")
    .eq("video_id", video.id)
    .order("position_seconds");

  const cpIds = (cps ?? []).map((c) => c.id);
  const { data: questions } = cpIds.length
    ? await supabase
        .from("quiz_questions")
        .select(
          "id, checkpoint_id, question, options, correct_index, explanation"
        )
        .in("checkpoint_id", cpIds)
        .order("order_index")
    : { data: [] };

  const checkpoints = (cps ?? []).map((cp) => ({
    id: cp.id,
    position_seconds: cp.position_seconds,
    label: cp.label ?? `שאלות ב-${fmtSec(cp.position_seconds)}`,
    questions: (questions ?? [])
      .filter((q) => q.checkpoint_id === cp.id)
      .map((q) => ({
        id: q.id,
        question: q.question,
        options: (q.options as unknown as string[]) ?? [],
        correct: q.correct_index,
        explanation: q.explanation ?? "",
      })),
  }));

  const totalQuestions = checkpoints.reduce((s, cp) => s + cp.questions.length, 0);

  return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col">
      <header className="px-4 sm:px-6 py-4 flex items-center justify-between border-b border-gray-800">
        <Link href="/" className="text-xl font-bold text-white">
          Ort<span className="text-blue-400">Tube</span>
        </Link>
        {user?.email && user.user_metadata?.role === "student" && (
          <Link
            href="/student"
            className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
          >
            → השיעורים שלי
          </Link>
        )}
      </header>

      <main className="flex-1 flex flex-col items-center justify-start pt-6 px-4 pb-10">
        <div className="w-full max-w-4xl space-y-4">
          <div className="space-y-2">
            <h1 dir="auto" className="text-white text-lg sm:text-xl font-semibold leading-snug">
              {video.title ?? "שיעור בווידאו"}
            </h1>
            {checkpoints.length > 0 && (
              <p className="text-gray-500 text-sm">
                בשיעור הזה {totalQuestions} שאלות ב-{checkpoints.length} נקודות
                עצירה. הסרטון ייעצר אוטומטית בכל נקודה.
              </p>
            )}
          </div>

          <StudentPlayer
            videoUuid={video.id}
            videoId={video.youtube_video_id}
            summary={transcriptRow?.summary ?? null}
            checkpoints={checkpoints}
            previousResult={
              completedSession
                ? {
                    score: completedSession.final_score,
                    total: completedSession.total_questions,
                  }
                : null
            }
            resume={resume}
          />
        </div>
      </main>
    </div>
  );
}

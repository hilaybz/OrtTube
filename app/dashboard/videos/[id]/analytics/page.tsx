import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

interface Props {
  params: Promise<{ id: string }>;
}

function fmtSec(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default async function AnalyticsPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const { data: video } = await supabase
    .from("videos")
    .select("id, title, youtube_video_id, share_code")
    .eq("id", id)
    .eq("teacher_id", user.id)
    .single();
  if (!video) redirect("/dashboard");

  const { data: sessions } = await supabase
    .from("student_sessions")
    .select("id, started_at, completed_at, final_score, total_questions")
    .eq("video_id", id);

  const { data: cps } = await supabase
    .from("quiz_checkpoints")
    .select("id, position_seconds, label, order_index")
    .eq("video_id", id)
    .order("position_seconds");

  const cpIds = (cps ?? []).map((c) => c.id);
  const { data: questions } = cpIds.length
    ? await supabase
        .from("quiz_questions")
        .select(
          "id, checkpoint_id, question, options, correct_index, order_index"
        )
        .in("checkpoint_id", cpIds)
        .order("order_index")
    : { data: [] };

  const sessionIds = (sessions ?? []).map((s) => s.id);
  const { data: answers } = sessionIds.length
    ? await supabase
        .from("student_answers")
        .select("question_id, is_correct")
        .in("session_id", sessionIds)
    : { data: [] };

  // Aggregate
  const totalSessions = sessions?.length ?? 0;
  const completed = (sessions ?? []).filter((s) => s.completed_at !== null);
  const completionRate =
    totalSessions > 0 ? (completed.length / totalSessions) * 100 : 0;
  const avgScore =
    completed.length > 0
      ? completed.reduce((sum, s) => sum + (s.final_score ?? 0), 0) /
        completed.length
      : 0;
  const avgTotal =
    completed.length > 0
      ? completed.reduce((sum, s) => sum + (s.total_questions ?? 0), 0) /
        completed.length
      : 0;

  const questionStats = (questions ?? []).map((q) => {
    const qAnswers = (answers ?? []).filter((a) => a.question_id === q.id);
    const correctCount = qAnswers.filter((a) => a.is_correct).length;
    return {
      ...q,
      totalAnswers: qAnswers.length,
      correctCount,
      correctPct:
        qAnswers.length > 0 ? (correctCount / qAnswers.length) * 100 : 0,
    };
  });

  const cpStats = (cps ?? []).map((cp) => ({
    ...cp,
    questions: questionStats.filter((q) => q.checkpoint_id === cp.id),
  }));

  return (
    <div className="min-h-screen bg-[#0f1117]">
      <header className="px-6 py-4 border-b border-gray-800 flex items-center gap-4">
        <Link
          href="/dashboard"
          className="text-xl font-bold text-white shrink-0"
        >
          Ort<span className="text-blue-400">Tube</span>
        </Link>
        <span className="text-gray-700">·</span>
        <span className="text-gray-400 text-sm truncate">
          {video.title ?? video.youtube_video_id}
        </span>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link
            href={`/dashboard/videos/${id}`}
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            ← Back to editor
          </Link>
        </div>

        <h2 className="text-2xl font-bold text-white mb-1">Analytics</h2>
        <p className="text-gray-500 text-sm mb-8">
          {video.title ?? video.youtube_video_id}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <StatCard
            label="Total sessions"
            value={totalSessions.toString()}
          />
          <StatCard
            label="Completion rate"
            value={totalSessions > 0 ? `${completionRate.toFixed(0)}%` : "—"}
            sub={
              totalSessions > 0
                ? `${completed.length} of ${totalSessions}`
                : undefined
            }
          />
          <StatCard
            label="Average score"
            value={
              completed.length > 0
                ? `${avgScore.toFixed(1)} / ${avgTotal.toFixed(0)}`
                : "—"
            }
            sub={
              completed.length > 0
                ? `${completed.length} completed`
                : undefined
            }
          />
        </div>

        {totalSessions === 0 ? (
          <div className="text-center py-12 border border-dashed border-gray-800 rounded-xl">
            <p className="text-gray-500 text-sm">No student sessions yet.</p>
            <p className="text-gray-600 text-xs mt-1">
              Share the link with students to see analytics here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {cpStats.map((cp) => (
              <div
                key={cp.id}
                className="bg-[#161920] border border-gray-800 rounded-xl overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-3">
                  <span className="text-white text-sm font-mono shrink-0">
                    {fmtSec(cp.position_seconds)}
                  </span>
                  <span className="text-gray-400 text-sm truncate">
                    {cp.label ?? `Quiz at ${fmtSec(cp.position_seconds)}`}
                  </span>
                </div>
                <div className="px-5 py-4 space-y-4">
                  {cp.questions.length === 0 && (
                    <p className="text-gray-600 text-xs">
                      No questions in this checkpoint.
                    </p>
                  )}
                  {cp.questions.map((q, i) => (
                    <QuestionStats key={q.id} q={q} index={i} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-[#161920] border border-gray-800 rounded-xl px-5 py-4">
      <p className="text-gray-500 text-xs">{label}</p>
      <p className="text-white text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-gray-600 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

interface StatsShape {
  id: string;
  question: string;
  totalAnswers: number;
  correctCount: number;
  correctPct: number;
}

function QuestionStats({ q, index }: { q: StatsShape; index: number }) {
  return (
    <div className="bg-[#0f1117] rounded-lg p-3 flex items-start justify-between gap-3">
      <p className="text-sm text-white leading-snug">
        <span className="text-gray-600 text-xs mr-1">Q{index + 1}.</span>
        {q.question}
      </p>
      <div className="shrink-0 text-right">
        <p
          className={`text-sm font-semibold ${
            q.totalAnswers === 0
              ? "text-gray-500"
              : q.correctPct >= 70
              ? "text-green-400"
              : q.correctPct >= 40
              ? "text-yellow-400"
              : "text-red-400"
          }`}
        >
          {q.totalAnswers > 0
            ? `${q.correctCount} / ${q.totalAnswers}`
            : "—"}
        </p>
        {q.totalAnswers > 0 && (
          <p className="text-xs text-gray-500 mt-0.5">
            {q.correctPct.toFixed(0)}% correct
          </p>
        )}
      </div>
    </div>
  );
}

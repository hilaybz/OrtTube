import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function StudentDashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) redirect("/auth/sign-in");
  if (user.user_metadata?.role !== "student") redirect("/dashboard");

  const { data: profile } = await supabase
    .from("students")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const displayName =
    profile?.display_name ??
    (user.user_metadata?.display_name as string | undefined) ??
    user.email;

  // For now every student sees every video from every teacher;
  // per-teacher assignment comes later.
  const { data: videos } = await supabase
    .from("videos")
    .select("id, title, youtube_video_id, share_code, transcript_status, created_at")
    .order("created_at", { ascending: false });

  const { data: sessions } = await supabase
    .from("student_sessions")
    .select("video_id, started_at, completed_at, final_score, total_questions")
    .eq("supabase_user_id", user.id)
    .order("started_at", { ascending: false });

  // A video counts as completed if ANY of the student's sessions completed
  // (an abandoned rewatch must not hide an earlier completion). Sessions
  // are sorted newest-first, so the first completed one we see per video
  // is the most recent completion.
  const latestByVideo = new Map<
    string,
    { completed_at: string | null; final_score: number | null; total_questions: number | null }
  >();
  for (const s of sessions ?? []) {
    const existing = latestByVideo.get(s.video_id);
    if (!existing || (s.completed_at && !existing.completed_at)) {
      latestByVideo.set(s.video_id, s);
    }
  }

  const completedSessions = (sessions ?? []).filter((s) => s.completed_at !== null);
  const completedVideoCount = new Set(completedSessions.map((s) => s.video_id)).size;
  // One score per video (the most recent completion), so redoing or
  // duplicate sessions don't skew the average.
  const latestCompletedByVideo = new Map<string, (typeof completedSessions)[number]>();
  for (const s of completedSessions) {
    if (!latestCompletedByVideo.has(s.video_id)) latestCompletedByVideo.set(s.video_id, s);
  }
  const scored = [...latestCompletedByVideo.values()].filter(
    (s) => s.final_score !== null && s.total_questions
  );
  const avgPct =
    scored.length > 0
      ? Math.round(
          (scored.reduce(
            (sum, s) => sum + (s.final_score! / s.total_questions!) * 100,
            0
          ) /
            scored.length)
        )
      : null;

  return (
    <div className="min-h-screen bg-[#0f1117]">
      <header className="px-4 sm:px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <Link href="/student" className="text-xl font-bold text-white">
          Ort<span className="text-blue-400">Tube</span>
        </Link>
        <div className="flex items-center gap-4">
          <span dir="auto" className="text-sm text-gray-400 truncate max-w-40 sm:max-w-none">
            {displayName}
          </span>
          <form action="/auth/sign-out" method="POST">
            <button
              type="submit"
              className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
            >
              התנתקות
            </button>
          </form>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        {/* Profile / stats */}
        <div className="mb-8">
          <h2 dir="auto" className="text-2xl font-bold text-white">
            שלום, {displayName}
          </h2>
          <div className="flex flex-wrap gap-3 mt-4">
            <span className="text-sm px-3 py-1.5 rounded-full bg-[#161920] border border-gray-800 text-gray-300">
              🎬 {videos?.length ?? 0} שיעורים זמינים
            </span>
            <span className="text-sm px-3 py-1.5 rounded-full bg-[#161920] border border-gray-800 text-gray-300">
              ✅ {completedVideoCount} הושלמו
            </span>
            {avgPct !== null && (
              <span className="text-sm px-3 py-1.5 rounded-full bg-[#161920] border border-gray-800 text-gray-300">
                📊 ציון ממוצע {avgPct}%
              </span>
            )}
          </div>
        </div>

        <h3 className="text-white font-semibold mb-4">השיעורים שלי</h3>

        {!videos || videos.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-gray-800 rounded-xl">
            <p className="text-gray-500 text-sm">עדיין אין שיעורים.</p>
            <p className="text-gray-600 text-xs mt-1">
              כשהמורים יוסיפו סרטונים, הם יופיעו כאן.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {videos.map((v) => {
              const session = latestByVideo.get(v.id);
              return (
                <li key={v.id}>
                  <Link
                    href={`/s/${v.share_code}`}
                    className="flex items-center gap-4 bg-[#161920] border border-gray-800 rounded-xl px-4 sm:px-5 py-4 hover:border-gray-600 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p dir="auto" className="text-white font-medium truncate">
                        {v.title ?? "שיעור בווידאו"}
                      </p>
                      <p className="text-gray-500 text-xs mt-0.5">
                        {new Date(v.created_at).toLocaleDateString("he-IL")}
                      </p>
                    </div>
                    <StatusBadge session={session} />
                    <span className="hidden sm:inline text-gray-600 group-hover:text-gray-400 transition-colors text-sm">
                      ←
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}

function StatusBadge({
  session,
}: {
  session?: {
    completed_at: string | null;
    final_score: number | null;
    total_questions: number | null;
  };
}) {
  if (!session) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-400 border border-gray-700 whitespace-nowrap">
        טרם נצפה
      </span>
    );
  }
  if (session.completed_at) {
    const score =
      session.final_score !== null && session.total_questions
        ? ` · ${session.final_score}/${session.total_questions}`
        : "";
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 whitespace-nowrap">
        הושלם{score}
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 whitespace-nowrap">
      בתהליך
    </span>
  );
}

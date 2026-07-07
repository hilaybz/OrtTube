import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchYouTubeTitle } from "@/lib/youtube";
import DeleteVideoButton from "./DeleteVideoButton";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  let teacher: { display_name: string | null } | null = null;

  const selectResult = await supabase
    .from("teachers")
    .select("display_name")
    .eq("id", user.id)
    .single();

  if (selectResult.data) {
    teacher = selectResult.data;
  } else {
    const insertResult = await supabase
      .from("teachers")
      .insert({ id: user.id, email: user.email! })
      .select("display_name")
      .single();
    teacher = insertResult.data;
  }

  if (!teacher) {
    redirect("/auth/sign-in");
  }

  const { data: videos } = await supabase
    .from("videos")
    .select("id, title, youtube_video_id, share_code, transcript_status, created_at")
    .eq("teacher_id", user.id)
    .order("created_at", { ascending: false });

  // One-time backfill of YouTube titles for existing videos that don't have one yet.
  // After this, the column stays populated.
  const missingTitle = (videos ?? []).filter((v) => !v.title);
  if (missingTitle.length > 0) {
    const fetched = await Promise.all(
      missingTitle.map(async (v) => ({
        id: v.id,
        title: await fetchYouTubeTitle(v.youtube_video_id),
      }))
    );
    await Promise.all(
      fetched
        .filter((f): f is { id: string; title: string } => Boolean(f.title))
        .map((f) =>
          supabase.from("videos").update({ title: f.title }).eq("id", f.id)
        )
    );
    for (const f of fetched) {
      if (!f.title) continue;
      const v = videos?.find((x) => x.id === f.id);
      if (v) v.title = f.title;
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1117]">
      {/* Nav */}
      <header className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <Link href="/dashboard" className="text-xl font-bold text-white">
          Ort<span className="text-blue-400">Tube</span>
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">
            {teacher.display_name ?? user.email}
          </span>
          <SignOutButton />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-white">My Videos</h2>
          <Link
            href="/dashboard/videos/new"
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
          >
            + Add video
          </Link>
        </div>

        {!videos || videos.length === 0 ? (
          <div className="text-center py-20 space-y-3">
            <p className="text-gray-400">No videos yet.</p>
            <p className="text-gray-600 text-sm">
              Add a YouTube video to generate quizzes and share with students.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {videos.map((v) => (
              <li key={v.id} className="group flex items-center gap-2">
                <Link
                  href={`/dashboard/videos/${v.id}`}
                  className="flex-1 flex items-center gap-4 bg-[#161920] border border-gray-800 rounded-xl px-5 py-4 hover:border-gray-600 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">
                      {v.title ?? "Untitled"}
                    </p>
                    <p className="text-gray-500 text-xs mt-0.5">
                      <span className="font-mono text-gray-600">
                        {v.youtube_video_id}
                      </span>
                      {" · "}
                      Share code:{" "}
                      <span className="font-mono text-gray-400">
                        {v.share_code}
                      </span>
                      {" · "}
                      {new Date(v.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <StatusBadge status={v.transcript_status} />
                  <span className="text-gray-600 group-hover:text-gray-400 transition-colors text-sm">→</span>
                </Link>
                <DeleteVideoButton videoId={v.id} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ready")
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
        Ready
      </span>
    );
  if (status === "unavailable")
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
        No transcript
      </span>
    );
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-400 border border-gray-700">
      Pending
    </span>
  );
}

// ── Sign-out button (needs client interactivity) ──────────────────────────────

function SignOutButton() {
  return (
    <form action="/auth/sign-out" method="POST">
      <button
        type="submit"
        className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        Sign out
      </button>
    </form>
  );
}

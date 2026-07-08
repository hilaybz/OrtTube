import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import VideoEditor from "./VideoEditor";
import CopyLinkButton from "./CopyLinkButton";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function VideoDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const { data: video } = await supabase
    .from("videos")
    .select(
      "id, title, youtube_video_id, share_code, transcript_status, created_at"
    )
    .eq("id", id)
    .eq("teacher_id", user.id)
    .single();

  if (!video) redirect("/dashboard");

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
          "id, checkpoint_id, question, options, correct_index, explanation, ai_generated, order_index"
        )
        .in("checkpoint_id", cpIds)
        .order("order_index")
    : { data: [] };

  const checkpoints = (cps ?? []).map((cp) => ({
    ...cp,
    questions: (questions ?? [])
      .filter((q) => q.checkpoint_id === cp.id)
      .map((q) => ({
        ...q,
        options: (q.options as unknown as string[]) ?? [],
      })),
  }));

  return (
    <div className="min-h-screen bg-[#0f1117]">
      <header className="sticky top-0 z-40 bg-[#0f1117]/80 backdrop-blur-md px-4 sm:px-6 py-4 border-b border-gray-800 flex items-center gap-4">
        <Link href="/dashboard" className="text-xl font-bold text-white shrink-0">
          Ort<span className="text-blue-400">Tube</span>
        </Link>
        <span className="text-gray-700">·</span>
        <span dir="auto" className="text-gray-400 text-sm truncate">
          {video.title ?? video.youtube_video_id}
        </span>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
            >
              → כל הסרטונים
            </Link>
            <span className="text-gray-700 text-sm">·</span>
            <span className="text-sm text-gray-500">
              קוד שיתוף:{" "}
              <span dir="ltr" className="font-mono text-gray-300">{video.share_code}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/videos/${id}/analytics`}
              className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
            >
              📊 נתונים
            </Link>
            <CopyLinkButton shareCode={video.share_code} />
          </div>
        </div>

        <VideoEditor
          video={{
            id: video.id,
            youtube_video_id: video.youtube_video_id,
            title: video.title,
            transcript_status: video.transcript_status,
          }}
          initialCheckpoints={checkpoints}
        />
      </main>
    </div>
  );
}

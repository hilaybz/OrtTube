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
    label: cp.label ?? `Quiz at ${fmtSec(cp.position_seconds)}`,
    questions: (questions ?? [])
      .filter((q) => q.checkpoint_id === cp.id)
      .map((q) => ({
        question: q.question,
        options: (q.options as unknown as string[]) ?? [],
        correct: q.correct_index,
        explanation: q.explanation ?? "",
      })),
  }));

  return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col">
      <header className="px-6 py-4 flex items-center border-b border-gray-800">
        <Link href="/" className="text-xl font-bold text-white">
          Ort<span className="text-blue-400">Tube</span>
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-start pt-6 px-4 pb-10">
        <div className="w-full max-w-4xl">
          <div className="rounded-xl overflow-hidden border border-gray-800 shadow-2xl">
            <StudentPlayer
              videoId={video.youtube_video_id}
              checkpoints={checkpoints}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

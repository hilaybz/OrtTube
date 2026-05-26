import { createClient } from "@/lib/supabase/server";
import { getTranscript } from "@/lib/transcript";
import type { Json } from "@/lib/supabase/types";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: video } = await supabase
    .from("videos")
    .select("id, youtube_video_id, transcript_status")
    .eq("id", id)
    .eq("teacher_id", user.id)
    .single();
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (video.transcript_status !== "pending") {
    return NextResponse.json({ status: video.transcript_status });
  }

  const segments = await getTranscript(video.youtube_video_id);
  const status: "ready" | "unavailable" = segments ? "ready" : "unavailable";

  if (segments) {
    await supabase.from("youtube_transcripts").upsert({
      youtube_video_id: video.youtube_video_id,
      language: "auto",
      segments: segments as unknown as Json,
      source: "fetch",
    });
  }

  await supabase.from("videos").update({ transcript_status: status }).eq("id", id);
  return NextResponse.json({ status });
}

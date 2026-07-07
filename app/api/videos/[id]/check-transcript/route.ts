import { createClient } from "@/lib/supabase/server";
import { getTranscript, summarizeTranscript } from "@/lib/transcript";
import { fetchYouTubeTitle } from "@/lib/youtube";
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
    .select("id, youtube_video_id, transcript_status, title")
    .eq("id", id)
    .eq("teacher_id", user.id)
    .single();
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (video.transcript_status !== "pending") {
    return NextResponse.json({ status: video.transcript_status });
  }

  const [segments, fetchedTitle] = await Promise.all([
    getTranscript(video.youtube_video_id),
    video.title ? Promise.resolve(null) : fetchYouTubeTitle(video.youtube_video_id),
  ]);

  const status: "ready" | "unavailable" = segments ? "ready" : "unavailable";

  if (segments) {
    const summary = await summarizeTranscript(segments).catch(() => "");
    await supabase.from("youtube_transcripts").upsert({
      youtube_video_id: video.youtube_video_id,
      language: "auto",
      source: "fetch",
      summary: summary || null,
    });
  }

  const updates: { transcript_status: typeof status; title?: string } = {
    transcript_status: status,
  };
  if (fetchedTitle) updates.title = fetchedTitle;

  await supabase.from("videos").update(updates).eq("id", id);
  return NextResponse.json({ status });
}

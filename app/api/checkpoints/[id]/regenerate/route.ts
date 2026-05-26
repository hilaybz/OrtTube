import { createClient } from "@/lib/supabase/server";
import { generateQuestionsAtPositions } from "@/lib/transcript";
import type { TranscriptSegment } from "@/lib/transcript";
import type { Json } from "@/lib/supabase/types";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { count = 2 } = (await req.json()) as { count?: number };

  const { data: cp } = await supabase
    .from("quiz_checkpoints")
    .select("id, video_id, position_seconds")
    .eq("id", id)
    .single();
  if (!cp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: video } = await supabase
    .from("videos")
    .select("id, youtube_video_id")
    .eq("id", cp.video_id)
    .eq("teacher_id", user.id)
    .single();
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: transcriptRow } = await supabase
    .from("youtube_transcripts")
    .select("segments")
    .eq("youtube_video_id", video.youtube_video_id)
    .single();
  if (!transcriptRow) {
    return NextResponse.json({ error: "No transcript" }, { status: 400 });
  }

  const segments = transcriptRow.segments as unknown as TranscriptSegment[];
  const results = await generateQuestionsAtPositions(
    segments,
    [cp.position_seconds],
    count
  );

  await supabase.from("quiz_questions").delete().eq("checkpoint_id", id);

  const newQs = results[0]?.questions ?? [];
  if (newQs.length === 0) {
    return NextResponse.json({ questions: [] });
  }

  const { data: inserted } = await supabase
    .from("quiz_questions")
    .insert(
      newQs.map((q, i) => ({
        checkpoint_id: id,
        question: q.question,
        options: q.options as unknown as Json,
        correct_index: q.correct_index,
        explanation: q.explanation,
        ai_generated: true,
        order_index: i,
      }))
    )
    .select(
      "id, checkpoint_id, question, options, correct_index, explanation, ai_generated, order_index"
    );

  return NextResponse.json({
    questions: (inserted ?? []).map((q) => ({
      ...q,
      options: (q.options as unknown as string[]) ?? [],
    })),
  });
}

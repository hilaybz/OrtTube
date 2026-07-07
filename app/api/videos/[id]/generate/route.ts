import { createClient } from "@/lib/supabase/server";
import { generateQuestionsAtPositions, getTranscript } from "@/lib/transcript";
import type { Json } from "@/lib/supabase/types";
import { NextResponse, type NextRequest } from "next/server";

type Body =
  | { mode: "at_times"; positions: number[]; count: number }
  | { mode: "every"; intervalSeconds: number; totalSeconds: number; count: number };

function fmtSec(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

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

  const { data: video } = await supabase
    .from("videos")
    .select("id, youtube_video_id, transcript_status")
    .eq("id", id)
    .eq("teacher_id", user.id)
    .single();
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (video.transcript_status !== "ready") {
    return NextResponse.json({ error: "No transcript available" }, { status: 400 });
  }

  const body = (await req.json()) as Body;

  const segments = await getTranscript(video.youtube_video_id);
  if (!segments) {
    return NextResponse.json({ error: "Transcript unavailable" }, { status: 400 });
  }

  let positions: number[];
  if (body.mode === "at_times") {
    positions = [...body.positions].sort((a, b) => a - b);
  } else {
    const { intervalSeconds, totalSeconds } = body;
    positions = [];
    for (let t = intervalSeconds; t < totalSeconds - 30; t += intervalSeconds) {
      positions.push(Math.round(t));
    }
  }

  if (positions.length === 0) {
    return NextResponse.json({ error: "No valid positions" }, { status: 400 });
  }

  const results = await generateQuestionsAtPositions(segments, positions, body.count);

  const { data: last } = await supabase
    .from("quiz_checkpoints")
    .select("order_index")
    .eq("video_id", id)
    .order("order_index", { ascending: false })
    .limit(1);
  let orderBase = last?.[0]?.order_index ?? -1;

  const created = [];
  for (const result of results) {
    orderBase++;
    const { data: cp } = await supabase
      .from("quiz_checkpoints")
      .insert({
        video_id: id,
        position_seconds: result.position_seconds,
        label: `שאלות ב-${fmtSec(result.position_seconds)}`,
        order_index: orderBase,
      })
      .select("id, position_seconds, label, order_index")
      .single();

    if (!cp || result.questions.length === 0) {
      if (cp) created.push({ ...cp, questions: [] });
      continue;
    }

    const { data: insertedQs } = await supabase
      .from("quiz_questions")
      .insert(
        result.questions.map((q, i) => ({
          checkpoint_id: cp.id,
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

    created.push({
      ...cp,
      questions: (insertedQs ?? []).map((q) => ({
        ...q,
        options: (q.options as unknown as string[]) ?? [],
      })),
    });
  }

  return NextResponse.json({ checkpoints: created });
}

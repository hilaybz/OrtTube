import { createClient } from "@/lib/supabase/server";
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

  const { question, options, correct_index, explanation } = (await req.json()) as {
    question: string;
    options: string[];
    correct_index: number;
    explanation?: string;
  };

  const { data: cp } = await supabase
    .from("quiz_checkpoints")
    .select("id, video_id")
    .eq("id", id)
    .single();
  if (!cp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: video } = await supabase
    .from("videos")
    .select("id")
    .eq("id", cp.video_id)
    .eq("teacher_id", user.id)
    .single();
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: last } = await supabase
    .from("quiz_questions")
    .select("order_index")
    .eq("checkpoint_id", id)
    .order("order_index", { ascending: false })
    .limit(1);
  const order_index = (last?.[0]?.order_index ?? -1) + 1;

  const { data: q, error } = await supabase
    .from("quiz_questions")
    .insert({
      checkpoint_id: id,
      question,
      options: options as unknown as Json,
      correct_index,
      explanation: explanation ?? null,
      ai_generated: false,
      order_index,
    })
    .select(
      "id, checkpoint_id, question, options, correct_index, explanation, ai_generated, order_index"
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    question: { ...q, options: (q.options as unknown as string[]) ?? [] },
  });
}

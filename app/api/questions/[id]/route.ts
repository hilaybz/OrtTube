import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { NextResponse, type NextRequest } from "next/server";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify ownership
  const { data: q } = await supabase
    .from("quiz_questions")
    .select("id, checkpoint_id")
    .eq("id", id)
    .single();
  if (!q) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: cp } = await supabase
    .from("quiz_checkpoints")
    .select("video_id")
    .eq("id", q.checkpoint_id)
    .single();
  if (!cp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: video } = await supabase
    .from("videos")
    .select("id")
    .eq("id", cp.video_id)
    .eq("teacher_id", user.id)
    .single();
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { question, options, correct_index, explanation } = (await req.json()) as {
    question: string;
    options: string[];
    correct_index: number;
    explanation?: string;
  };

  const { data: updated, error } = await supabase
    .from("quiz_questions")
    .update({
      question,
      options: options as unknown as Json,
      correct_index,
      explanation: explanation ?? null,
    })
    .eq("id", id)
    .select(
      "id, checkpoint_id, question, options, correct_index, explanation, ai_generated, order_index"
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    question: { ...updated, options: (updated.options as unknown as string[]) ?? [] },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: q } = await supabase
    .from("quiz_questions")
    .select("id, checkpoint_id")
    .eq("id", id)
    .single();
  if (!q) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: cp } = await supabase
    .from("quiz_checkpoints")
    .select("video_id")
    .eq("id", q.checkpoint_id)
    .single();
  if (!cp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: video } = await supabase
    .from("videos")
    .select("id")
    .eq("id", cp.video_id)
    .eq("teacher_id", user.id)
    .single();
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await supabase.from("quiz_questions").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}

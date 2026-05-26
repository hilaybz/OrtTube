import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

function fmtSec(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export async function GET(
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
    .select("id")
    .eq("id", id)
    .eq("teacher_id", user.id)
    .single();
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: cps } = await supabase
    .from("quiz_checkpoints")
    .select("id, position_seconds, label, order_index")
    .eq("video_id", id)
    .order("position_seconds");

  if (!cps) return NextResponse.json({ checkpoints: [] });

  const cpIds = cps.map((c) => c.id);
  const { data: questions } = cpIds.length
    ? await supabase
        .from("quiz_questions")
        .select(
          "id, checkpoint_id, question, options, correct_index, explanation, ai_generated, order_index"
        )
        .in("checkpoint_id", cpIds)
        .order("order_index")
    : { data: [] };

  const checkpoints = cps.map((cp) => ({
    ...cp,
    questions: (questions ?? [])
      .filter((q) => q.checkpoint_id === cp.id)
      .map((q) => ({
        ...q,
        options: (q.options as unknown as string[]) ?? [],
      })),
  }));

  return NextResponse.json({ checkpoints });
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

  const { position_seconds, label } = (await req.json()) as {
    position_seconds: number;
    label?: string;
  };

  const { data: video } = await supabase
    .from("videos")
    .select("id")
    .eq("id", id)
    .eq("teacher_id", user.id)
    .single();
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: last } = await supabase
    .from("quiz_checkpoints")
    .select("order_index")
    .eq("video_id", id)
    .order("order_index", { ascending: false })
    .limit(1);
  const order_index = (last?.[0]?.order_index ?? -1) + 1;

  const { data: cp, error } = await supabase
    .from("quiz_checkpoints")
    .insert({
      video_id: id,
      position_seconds,
      label: label ?? `Quiz at ${fmtSec(position_seconds)}`,
      order_index,
    })
    .select("id, position_seconds, label, order_index")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ checkpoint: { ...cp, questions: [] } });
}

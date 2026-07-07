import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

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

  await supabase.from("quiz_checkpoints").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { label, position_seconds } = (await req.json()) as {
    label?: string;
    position_seconds?: number;
  };

  const updates: { label?: string; position_seconds?: number } = {};
  if (label !== undefined) updates.label = label;
  if (position_seconds !== undefined) {
    if (
      typeof position_seconds !== "number" ||
      !Number.isFinite(position_seconds) ||
      position_seconds < 0
    ) {
      return NextResponse.json(
        { error: "position_seconds must be a non-negative number" },
        { status: 400 }
      );
    }
    updates.position_seconds = Math.round(position_seconds);
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

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

  await supabase.from("quiz_checkpoints").update(updates).eq("id", id);
  return NextResponse.json({ ok: true });
}

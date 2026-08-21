import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getTranscript } from "@/lib/transcriptCache";

/**
 * POST /api/quizzes/[id]/transcript  — warm the transcript cache.
 *
 * Fetching is lazy: nothing pulls a transcript until a teacher presses generate
 * or a student asks the tutor, and by then they are waiting on it. A cold fetch
 * can take tens of seconds — proxy fallthrough, a ~1.2MB watch page, the
 * download itself — and if it fails, the single-flight claim throttles the next
 * automatic attempt for ten minutes, so the person who triggered it waits and
 * then gets nothing.
 *
 * This moves that work to page-open, where nobody is blocked on it. The teacher
 * editor and the student player each fire it once on mount and ignore the
 * result: by the time either feature is used the transcript is usually cached,
 * and if it could not be fetched that verdict is already recorded.
 *
 * Deliberately does NOT force. A forced fetch ignores the negative cache and
 * only respects a 30s floor, which is right for a human pressing a button but
 * wrong here — page opens are frequent and involuntary, and forcing would let a
 * teacher reloading the editor re-sweep the proxy pool every 30 seconds against
 * a metered bandwidth quota. Pressing "generate" still forces, as before.
 *
 * Body: `{ classId?: string }` — required for students, who are authorized by
 * class membership rather than ownership.
 *
 * Returns `{ status: "ready" | "unavailable" | "pending" | "skipped" }`.
 * `pending` means nobody has successfully read it yet: either the fetch is in
 * flight elsewhere, or the last attempt failed transiently and is being
 * throttled. `skipped` means no fetch was attempted because nothing on that
 * page could use the result.
 *
 * Errors: `{ error: { code, message } }` with codes:
 *   unauthorized(401), not_found(404), forbidden(403).
 */
export const runtime = "nodejs";
// A cold fetch sweeps the proxy pool across several endpoints; the default
// would cut it off partway and leave the cache exactly as cold as it started.
export const maxDuration = 60;

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: quizId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("unauthorized", "Sign in required", 401);

  let classId: string | null = null;
  try {
    const body = (await req.json()) as { classId?: unknown };
    if (typeof body?.classId === "string") classId = body.classId;
  } catch {
    // No body is fine — that's the teacher case.
  }

  // Owner-RLS lets a teacher read their own quiz; a student's select returns
  // nothing here, which is what sends them down the membership path below.
  const { data: quiz } = await supabase
    .from("quizzes")
    .select("id, author_id, video_id, deleted_at")
    .eq("id", quizId)
    .maybeSingle();
  const q = quiz as {
    id: string;
    author_id: string;
    video_id: string;
    deleted_at: string | null;
  } | null;

  let videoId: string | null = null;

  if (q && !q.deleted_at && q.author_id === user.id) {
    videoId = q.video_id;
  } else if (classId) {
    // Same gate the tutor itself uses, so warming can never reach a quiz the
    // student could not have asked about anyway: `get_tutor_mode` raises
    // not_member / not_assigned through the user client's auth.uid().
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc("get_tutor_mode", {
      p_class_id: classId,
      p_quiz_id: quizId,
    });
    if (error) {
      const msg = error.message ?? "";
      if (msg.includes("not_member")) return err("forbidden", "Not a class member", 403);
      if (msg.includes("not_assigned")) return err("not_found", "Quiz not assigned", 404);
      return err("forbidden", "Not permitted", 403);
    }
    const ctx = (Array.isArray(data) ? data[0] : data) as {
      youtube_video_id?: unknown;
      tutor_mode?: unknown;
    } | null;
    // The transcript exists for this student only to ground the tutor. With the
    // tutor off for their class they can never ask, so fetching would spend
    // metered proxy bandwidth on something nobody can reach.
    if (ctx?.tutor_mode === "off") {
      return NextResponse.json({ status: "skipped" });
    }
    if (typeof ctx?.youtube_video_id === "string") {
      return NextResponse.json({ status: await warm(ctx.youtube_video_id) });
    }
    return err("not_found", "Quiz video not found", 404);
  } else {
    return err("forbidden", "Not permitted", 403);
  }

  const { data: video } = await supabase
    .from("videos")
    .select("youtube_video_id")
    .eq("id", videoId)
    .maybeSingle();
  const v = video as { youtube_video_id: string } | null;
  if (!v) return err("not_found", "Quiz video not found", 404);

  return NextResponse.json({ status: await warm(v.youtube_video_id) });
}

/**
 * Service client because the fetch writes back to `videos` and Storage, which a
 * student's own grants do not permit — the read above is what authorized this.
 */
async function warm(youtubeVideoId: string): Promise<"ready" | "unavailable" | "pending"> {
  const service = createServiceClient();
  try {
    const transcript = await getTranscript(service, youtubeVideoId);
    if (transcript?.segments?.length) return "ready";
    // No segments covers both "confirmed no captions" and "could not read them
    // this time". The caller only needs to know it is not usable yet; the
    // distinction is already recorded on the video row and logged with a trace.
    return transcript ? "unavailable" : "pending";
  } catch {
    // Warming is best-effort by definition. A failure here must never surface
    // to a teacher opening the editor or a student opening a quiz.
    return "pending";
  }
}

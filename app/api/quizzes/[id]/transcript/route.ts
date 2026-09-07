import { NextResponse, after, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getTranscript } from "@/lib/transcriptCache";
import { createRateLimiter } from "@/lib/rateLimit";

/**
 * Deliberately does NOT force. Forcing ignores the negative cache, which is right
 * for a human pressing a button and wrong here — page opens are frequent and
 * involuntary, and forcing would let a teacher reloading the editor re-check a
 * known caption-less video every time, against metered bandwidth.
 *
 * The 202 is also sent BEFORE the fetch runs, via `after`. Awaiting the fetch
 * first held the request open for as long as the work took — seconds, on a page
 * that had just finished loading and was hydrating its player — for a response
 * whose content nobody reads. `after` is what makes that honest: the platform
 * keeps the invocation alive for the callback, so the work still completes,
 * without a browser connection standing idle until it does. It does not make the
 * fetch cheaper, only unobserved.
 */
export const runtime = "nodejs";
// A cold fetch can try several exits across two endpoints; the default would cut
// it off partway and leave the cache exactly as cold as it started.
export const maxDuration = 60;

/**
 * Page opens are involuntary and this endpoint spends metered proxy bandwidth, so
 * it needs the same protection `/api/ask` has for the same reason. Generous
 * against real use — the client fires once per mount — and tight enough that a
 * loop cannot turn page-opens into a bandwidth bill.
 */
const isRateLimited = createRateLimiter({ windowMs: 60_000, max: 6 });

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

const accepted = () => new NextResponse(null, { status: 202 });

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

  if (isRateLimited(user.id)) {
    return err("rate_limited", "Too many transcript warm requests", 429);
  }

  let classId: string | null = null;
  try {
    const body = (await req.json()) as { classId?: unknown };
    if (typeof body?.classId === "string") classId = body.classId;
  } catch {
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
      console.error(`[transcript-warm] get_tutor_mode failed quiz=${quizId}: ${msg}`);
      return err("internal_error", "Could not check quiz access", 500);
    }
    const ctx = (Array.isArray(data) ? data[0] : data) as {
      youtube_video_id?: unknown;
      tutor_mode?: unknown;
    } | null;
    // The transcript exists for this student only to ground the tutor. With the
    // tutor off for their class they can never ask, so fetching would spend
    // metered proxy bandwidth on something nobody can reach.
    if (ctx?.tutor_mode === "off") return accepted();
    if (typeof ctx?.youtube_video_id === "string") {
      const youtubeVideoId = ctx.youtube_video_id;
      after(() => warm(youtubeVideoId));
      return accepted();
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

  after(() => warm(v.youtube_video_id));
  return accepted();
}

/**
 * Service client because the fetch writes back to `videos` and Storage, which a
 * student's own grants do not permit — the read above is what authorized this.
 *
 * Swallows its own failures rather than rejecting, because it runs detached from
 * the response: there is no longer a caller left to hand an error to.
 */
async function warm(youtubeVideoId: string): Promise<void> {
  try {
    await getTranscript(createServiceClient(), youtubeVideoId);
  } catch (e) {
    console.warn(
      `[transcript-warm] video=${youtubeVideoId} ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

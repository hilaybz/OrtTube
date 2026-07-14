import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getTranscript } from "@/lib/transcriptCache";
import { generateQuizQuestions } from "@/lib/ai/generate";
import { persistGeneratedQuestions, QuizError } from "@/lib/quiz";
import type { Language } from "@/lib/lang";

/**
 * POST /api/quizzes/[id]/generate  — AI strategic generation.
 *
 * Owner-only. Generates `count` questions in the quiz's base_language at
 * segment-aligned positions from the READY transcript, then persists them via
 * `upsert_question(source='generated')`. Manual authoring stays available when
 * the transcript is unavailable — this endpoint just refuses to auto-generate.
 *
 * Errors: `{ error: { code, message } }` with codes:
 *   unauthorized(401), invalid_request(400), not_found(404), forbidden(403),
 *   transcript_unavailable(409), generation_failed(422).
 */
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

  let count = 3;
  try {
    const body = (await req.json()) as { count?: number };
    if (body && typeof body.count === "number") count = body.count;
  } catch {
    // empty body → default count
  }
  if (!Number.isFinite(count) || count < 1 || count > 20) {
    return err("invalid_request", "count must be between 1 and 20", 400);
  }

  // Owner check via the authenticated client (owner-RLS lets a teacher read own).
  const { data: quiz } = await supabase
    .from("quizzes")
    .select("id, author_id, video_id, base_language, deleted_at")
    .eq("id", quizId)
    .maybeSingle();
  const q = quiz as {
    id: string;
    author_id: string;
    video_id: string;
    base_language: Language;
    deleted_at: string | null;
  } | null;
  if (!q || q.deleted_at) return err("not_found", "Quiz not found", 404);
  if (q.author_id !== user.id) return err("forbidden", "Not the quiz owner", 403);

  const { data: video } = await supabase
    .from("videos")
    .select("youtube_video_id, transcript_status")
    .eq("id", q.video_id)
    .maybeSingle();
  const v = video as {
    youtube_video_id: string;
    transcript_status: "pending" | "ready" | "unavailable";
  } | null;
  if (!v) return err("not_found", "Quiz video not found", 404);

  // Only a CONFIRMED no-captions video refuses up front. A 'pending' (or
  // otherwise not-yet-'ready') video is warmed via getTranscript first — it
  // single-flight fetches, caches, and promotes the status — so generation is
  // reachable for a fresh video instead of being blocked before any fetch.
  if (v.transcript_status === "unavailable") {
    return err(
      "transcript_unavailable",
      "This video has no captions; add questions manually instead",
      409
    );
  }

  // Transcript read needs the service client (shared videos + storage).
  const service = createServiceClient();
  const transcript = await getTranscript(service, v.youtube_video_id);
  const segments = transcript?.segments ?? [];
  if (segments.length === 0) {
    // After the fetch attempt there is still nothing usable (confirmed
    // unavailable, or a transient failure) — refuse and let the teacher author
    // manually.
    return err(
      "transcript_unavailable",
      "This video has no ready transcript; add questions manually instead",
      409
    );
  }

  const generated = await generateQuizQuestions(segments, count, q.base_language);
  if (generated.length === 0) {
    return err("generation_failed", "The model returned no usable questions", 422);
  }

  try {
    // Persist via the AUTHENTICATED client so upsert_question's auth.uid() owner
    // check resolves to this teacher.
    const ids = await persistGeneratedQuestions(supabase, quizId, generated);
    const questions = generated.map((gen, i) => ({
      id: ids[i],
      kind: gen.kind,
      position_seconds: gen.position_seconds,
      order_index: gen.order_index,
      base_language: q.base_language,
      prompt: gen.base_prompt,
      explanation: gen.base_explanation,
      options: gen.options.map((o) => ({
        text: o.base_text,
        is_correct: o.is_correct,
        order_index: o.order_index,
      })),
    }));
    return NextResponse.json({ questions }, { status: 201 });
  } catch (e) {
    if (e instanceof QuizError) {
      const status = e.code === "not_owner" || e.code === "not_authorized" ? 403 : 400;
      return err(e.code, "Failed to persist generated questions", status);
    }
    return err("generation_failed", "Failed to persist generated questions", 500);
  }
}

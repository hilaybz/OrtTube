import { type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getTranscript } from "@/lib/transcriptCache";
import { sliceTranscriptToPlayhead } from "@/lib/transcript";
import { resolveLanguage } from "@/lib/lang";
import {
  buildTutorSystemPrompt,
  buildTutorUserMessage,
  TUTOR_MAX_TOKENS,
  TUTOR_MODEL,
  TRANSCRIPT_TOKEN_CAP,
  type TutorMode,
} from "@/lib/tutor";

/**
 * AI tutor (`POST /api/ask`), streaming.
 *
 * Flow:
 *   1. Authenticate the caller (signed-in student).
 *   2. `get_tutor_mode` SD RPC (through the user client, so auth.uid() is the
 *      student): enforces class membership + assignment and returns the per-class
 *      tutor_mode plus language/video context. `off` → 403 { code: 'tutor_off' }.
 *   3. Resolve the response language (preferred → class → quiz base).
 *   4. Build context = transcript sliced to the playhead (never beyond) via the
 *      service client (Storage read). Token-capped, most-recent verbatim.
 *   5. Stream Claude's answer, shaped by mode + active-question protection.
 *   6. After the stream, log a `tutor_questions` row via the service client
 *      (students have no direct write). A logging failure must not break the
 *      stream.
 */

export const dynamic = "force-dynamic";

const MAX_PROMPT_CHARS = 1000;

// Per-user sliding-window rate limit. In-memory, so each serverless instance
// counts separately — good enough to stop cost abuse at pilot scale; swap for a
// shared store (e.g. Upstash) if the app grows.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 10;
const rateBuckets = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (rateBuckets.get(userId) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS
  );
  if (recent.length >= RATE_MAX_REQUESTS) {
    rateBuckets.set(userId, recent);
    return true;
  }
  recent.push(now);
  rateBuckets.set(userId, recent);
  return false;
}

interface AskBody {
  classId?: unknown;
  quizId?: unknown;
  videoId?: unknown;
  positionSeconds?: unknown;
  prompt?: unknown;
  attemptId?: unknown;
  activeQuestionId?: unknown;
}

/** Shape returned by the `get_tutor_mode` SD RPC. */
interface TutorContext {
  tutor_mode: TutorMode;
  class_language: string | null;
  base_language: string | null;
  preferred_language: string | null;
  video_id: string;
  youtube_video_id: string;
}

function isTutorContext(v: unknown): v is TutorContext {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    (o.tutor_mode === "off" ||
      o.tutor_mode === "hints" ||
      o.tutor_mode === "full") &&
    typeof o.video_id === "string" &&
    typeof o.youtube_video_id === "string"
  );
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function asOptionalString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError(401, "unauthenticated", "Sign in to use the tutor.");
  }
  if (isRateLimited(user.id)) {
    return jsonError(
      429,
      "rate_limited",
      "Too many requests — try again in a minute."
    );
  }

  let body: AskBody;
  try {
    body = (await req.json()) as AskBody;
  } catch {
    return jsonError(400, "invalid_body", "Request body must be valid JSON.");
  }

  const classId = asOptionalString(body.classId);
  const quizId = asOptionalString(body.quizId);
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const attemptId = asOptionalString(body.attemptId);
  const activeQuestionId = asOptionalString(body.activeQuestionId);
  const positionSeconds =
    typeof body.positionSeconds === "number" &&
    Number.isFinite(body.positionSeconds) &&
    body.positionSeconds > 0
      ? Math.floor(body.positionSeconds)
      : 0;

  if (!classId || !quizId) {
    return jsonError(400, "invalid_body", "classId and quizId are required.");
  }
  if (!prompt.trim()) {
    return jsonError(400, "invalid_body", "A question prompt is required.");
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return jsonError(400, "prompt_too_long", "Your question is too long.");
  }

  // ── Membership + assignment gate; load per-class mode & context ─────────────
  // Called through the user client so the RPC's auth.uid() is this student.
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;

  const { data: ctxData, error: ctxError } = await rpc("get_tutor_mode", {
    p_class_id: classId,
    p_quiz_id: quizId,
  });

  if (ctxError) {
    const msg = ctxError.message ?? "";
    if (msg.includes("not_authenticated")) {
      return jsonError(401, "unauthenticated", "Sign in to use the tutor.");
    }
    if (msg.includes("not_member")) {
      return jsonError(403, "not_member", "You are not a member of this class.");
    }
    if (msg.includes("not_assigned")) {
      return jsonError(
        404,
        "not_assigned",
        "This quiz is not assigned to this class."
      );
    }
    return jsonError(
      500,
      "tutor_lookup_failed",
      "Could not resolve the tutor for this quiz."
    );
  }

  if (!isTutorContext(ctxData)) {
    return jsonError(500, "tutor_lookup_failed", "Unexpected tutor context.");
  }

  if (ctxData.tutor_mode === "off") {
    return jsonError(403, "tutor_off", "The tutor is disabled for this class.");
  }
  // Narrow to the modes the prompt builder accepts (`off` handled above).
  const mode: Exclude<TutorMode, "off"> = ctxData.tutor_mode;

  const language = resolveLanguage(
    ctxData.preferred_language,
    ctxData.class_language,
    ctxData.base_language
  );

  const service = createServiceClient();

  // ── Server-side validation of client-supplied ids (B3) + active-question
  //    derivation from SERVER state (A4) ────────────────────────────────────────
  // The client cannot be trusted with attemptId/questionId (they feed a
  // service-role insert) nor with whether a question is "active". We validate both
  // against the DB and derive active-ness from the caller's own in-progress
  // attempt on THIS quiz — the client's activeQuestionId may only ADD specificity.
  let validatedAttemptId: string | null = null;
  let validatedQuestionId: string | null = null;
  let hasInProgressAttempt = false;

  {
    const { data: inProg } = await service
      .from("attempts")
      .select("id")
      .eq("student_id", user.id)
      .eq("quiz_id", quizId)
      .is("completed_at", null)
      .limit(1);
    hasInProgressAttempt = Array.isArray(inProg) && inProg.length > 0;
  }

  if (attemptId) {
    const { data: att } = await service
      .from("attempts")
      .select("student_id, quiz_id")
      .eq("id", attemptId)
      .maybeSingle();
    const a = att as { student_id: string | null; quiz_id: string } | null;
    // Keep only if it is the caller's own attempt AND on this exact quiz.
    if (a && a.student_id === user.id && a.quiz_id === quizId) {
      validatedAttemptId = attemptId;
    }
  }

  if (activeQuestionId) {
    const { data: qn } = await service
      .from("questions")
      .select("quiz_id")
      .eq("id", activeQuestionId)
      .maybeSingle();
    const q = qn as { quiz_id: string } | null;
    // Keep only if the question actually belongs to this quiz.
    if (q && q.quiz_id === quizId) {
      validatedQuestionId = activeQuestionId;
    }
  }

  // ── Playhead-bounded transcript context (never beyond the playhead) ─────────
  let transcriptContext = "";
  try {
    const transcript = await getTranscript(service, ctxData.youtube_video_id);
    if (transcript && transcript.segments.length > 0) {
      transcriptContext = sliceTranscriptToPlayhead(
        transcript.segments,
        positionSeconds,
        TRANSCRIPT_TOKEN_CAP
      );
    }
  } catch (err) {
    // A transcript failure must not break the tutor — proceed with no context.
    console.error("[ask] transcript fetch failed:", err);
  }

  // Derived from SERVER state: a question is "active" when the caller has an
  // in-progress attempt on this quiz, or supplied a valid on-screen question id.
  // (The always-on answer-leak guard in the system prompt applies regardless.)
  const hasActiveQuestion = hasInProgressAttempt || validatedQuestionId !== null;

  const client = new Anthropic();
  const aiStream = client.messages.stream({
    model: TUTOR_MODEL,
    max_tokens: TUTOR_MAX_TOKENS,
    system: buildTutorSystemPrompt({ language, mode, hasActiveQuestion }),
    messages: [
      {
        role: "user",
        content: buildTutorUserMessage({
          transcriptContext,
          positionSeconds,
          prompt,
          hasActiveQuestion,
        }),
      },
    ],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";
      try {
        for await (const chunk of aiStream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            answer += chunk.delta.text;
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } catch (err) {
        controller.error(err);
        return;
      }

      // Log the interaction (best-effort). Never let a logging failure surface
      // to the student's stream. Uses the service client (no student write).
      try {
        const { error: logError } = await service
          .from("tutor_questions")
          .insert({
            student_id: user.id,
            class_id: classId,
            quiz_id: quizId,
            video_id: ctxData.video_id,
            // Validated ids only — a spoofed/foreign attempt or question is nulled.
            attempt_id: validatedAttemptId,
            question_id: validatedQuestionId,
            position_seconds: positionSeconds,
            prompt,
            ai_response: answer,
          });
        if (logError) {
          console.error("[ask] tutor_questions log failed:", logError.message);
        }
      } catch (err) {
        console.error("[ask] tutor_questions log threw:", err);
      }

      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

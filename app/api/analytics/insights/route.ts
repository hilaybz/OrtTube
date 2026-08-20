import { type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { AnalyticsError, fetchTutorPrompts } from "@/lib/analytics";
import { isSupportedLanguage, type Language } from "@/lib/lang";
import { LANGUAGE_NAMES } from "@/lib/ai/translate";

/**
 * POST /api/analytics/insights  — "analyse with AI" over the tutor questions.
 *
 * Reads the questions students asked OrtAI in ONE scope (a quiz or a class) via
 * the owner-checked `tutor_prompts_in_scope` RPC — run with the CALLER'S session
 * client, so RLS and the RPC's owner check apply and a non-owner gets
 * `not_owner` → 403 — then has Claude tell the teacher what those questions say
 * students are struggling with.
 *
 * Two clean halves, on purpose: the DB read is owner-gated in one place, and the
 * model call is a pure text transform that never touches the database. Nothing
 * is stored; each press is a fresh read of the current questions.
 *
 * Streamed as plain text, like `/api/ask` — an Opus-class synthesis over a few
 * hundred prompts takes long enough that a spinner would be the whole
 * experience. The one non-streaming response is the EMPTY scope: with no
 * questions to analyse there is nothing to stream and no model call is made, so
 * it answers `application/json` with `{ insight: null }`. Callers branch on the
 * response's content type; errors keep the uniform `{ error: { code, message } }`
 * envelope.
 */

export const dynamic = "force-dynamic";
// The platform duration limit covers the WHOLE streamed response, not just time
// to first token, so a long synthesis needs headroom past a short default.
export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-opus-5";
const MAX_TOKENS = 2048;

/** Upper bound on prompts handed to the model, keeping the request bounded. */
const MAX_PROMPTS = 300;

/**
 * Per-teacher sliding-window limit. This is a button that spends real money on a
 * frontier model, so it gets a tighter budget than a read endpoint. In-memory,
 * so each serverless instance counts separately — enough to stop accidental
 * hammering at pilot scale, exactly like the tutor's own limiter.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 4;
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

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

interface InsightsBody {
  quizId?: unknown;
  classId?: unknown;
  lang?: unknown;
}

function asOptionalString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function buildSystemPrompt(languageName: string): string {
  return [
    "You analyse the questions students asked an AI tutor while working through a video quiz,",
    "and report to their teacher what the class is actually struggling with.",
    `Write in ${languageName}, addressing the teacher.`,
    "",
    "Structure your answer as plain text, no markdown syntax of any kind:",
    "- one short opening line naming the overall picture;",
    "- then the recurring difficulties, one per line, each line starting with '• ',",
    "  naming the difficulty and then what the teacher can do about it;",
    "- then one final line flagging anything notable (for example: many questions",
    "  asked while a quiz question was on screen, which suggests students fishing",
    "  for answers rather than understanding).",
    "",
    "Be specific and grounded in the questions you were given. Name the concepts the",
    "students are asking about. Do not invent difficulties that are not in the questions,",
    "do not pad with generic teaching advice, and never quote a student's question as",
    "evidence of who asked it — you are given no identities and must not imply any.",
    "Keep the whole answer under 200 words.",
  ].join("\n");
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError(401, "unauthorized", "Sign in required");
  }
  if (isRateLimited(user.id)) {
    return jsonError(
      429,
      "rate_limited",
      "Too many analyses — try again in a minute."
    );
  }

  let body: InsightsBody;
  try {
    body = (await req.json()) as InsightsBody;
  } catch {
    return jsonError(400, "invalid_request", "Request body must be valid JSON.");
  }

  const quizId = asOptionalString(body.quizId);
  const classId = asOptionalString(body.classId);
  if ((quizId && classId) || (!quizId && !classId)) {
    return jsonError(
      400,
      "invalid_args",
      "exactly one of quizId or classId is required"
    );
  }
  const language: Language = isSupportedLanguage(body.lang) ? body.lang : "he";

  // Owner-checked read with the caller's own session.
  let prompts: string[];
  let flagged: number;
  try {
    const result = await fetchTutorPrompts(
      supabase as never,
      quizId ? { quizId } : { classId: classId as string }
    );
    prompts = result.prompts
      .map((p) => p.prompt.trim())
      .filter((p) => p.length > 0)
      .slice(0, MAX_PROMPTS);
    flagged = result.prompts.filter((p) => p.question_id != null).length;
  } catch (e) {
    if (e instanceof AnalyticsError) {
      const status = e.code === "not_owner" ? 403 : 400;
      return jsonError(status, e.code, e.message);
    }
    return jsonError(500, "internal_error", "Unexpected error");
  }

  // Nothing to analyse: never call the model, and say so in a shape the client
  // can tell apart from a streamed answer.
  if (prompts.length === 0) {
    return new Response(JSON.stringify({ insight: null }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const languageName = LANGUAGE_NAMES[language] ?? LANGUAGE_NAMES.he;
  const client = new Anthropic();
  const aiStream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    // A routine synthesis over short texts: low effort keeps time-to-first-token
    // short, which is what a teacher waiting on a button actually feels.
    output_config: { effort: "low" },
    system: buildSystemPrompt(languageName),
    messages: [
      {
        role: "user",
        content: `${prompts.length} questions were asked, ${flagged} of them while a quiz question was on screen.

Questions:
${JSON.stringify(prompts)}`,
      },
    ],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of aiStream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } catch (err) {
        controller.error(err);
        return;
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

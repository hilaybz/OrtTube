import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupportedLanguage } from "@/lib/lang";
import { ensureTranslation, QuizError } from "@/lib/quiz";

/**
 * POST /api/quizzes/[id]/translate  — eager per-language fill.
 *
 * Owner-only. Fills `question_translations` / `option_translations` for the
 * requested language by translating from the quiz's base_language rows (lazy,
 * cached, single-flight). Body: `{ language }`. This is the eager entry point
 * (e.g. a teacher pre-filling a class language); class assignment and the attempt read
 * path call `ensureTranslation` directly for the same effect.
 *
 * Errors: `{ error: { code, message } }` with codes:
 *   unauthorized(401), invalid_request(400), not_found(404), forbidden(403).
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

  let language: unknown;
  try {
    ({ language } = (await req.json()) as { language?: unknown });
  } catch {
    return err("invalid_request", "Body must be JSON with a language", 400);
  }
  if (!isSupportedLanguage(language)) {
    return err("invalid_request", "language must be one of he, ar, en", 400);
  }

  // Owner check via the authenticated client.
  const { data: quiz } = await supabase
    .from("quizzes")
    .select("author_id, deleted_at")
    .eq("id", quizId)
    .maybeSingle();
  const q = quiz as { author_id: string; deleted_at: string | null } | null;
  if (!q || q.deleted_at) return err("not_found", "Quiz not found", 404);
  if (q.author_id !== user.id) return err("forbidden", "Not the quiz owner", 403);

  try {
    const result = await ensureTranslation(quizId, language);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (e instanceof QuizError) return err(e.code, "Translation failed", 400);
    return err("translation_failed", "Translation failed", 500);
  }
}

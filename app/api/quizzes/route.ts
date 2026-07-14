import { NextResponse, type NextRequest } from "next/server";
import { createQuizForVideo } from "@/lib/quiz";
import { isSupportedLanguage } from "@/lib/lang";
import { extractVideoId } from "@/lib/youtube";
import { err, handleError, requireAuth } from "./http";

/**
 * POST /api/quizzes  (quiz authoring — create)
 *
 * Body: { youtubeId | youtubeUrl, baseLanguage, title? }. Atomically upserts the
 * canonical video and creates the first quiz on it via `create_quiz_for_video`.
 * Teacher-authed; the RPC enforces the active-teacher gate and derives the school
 * from the caller's profile. YouTube metadata is fetched server-side inside the
 * wrapper.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  let body: { youtubeId?: unknown; youtubeUrl?: unknown; baseLanguage?: unknown; title?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err("invalid_request", "Body must be JSON", 400);
  }

  // Accept either a bare 11-char id or a full YouTube URL.
  let youtubeId = typeof body.youtubeId === "string" ? body.youtubeId.trim() : "";
  if (!youtubeId && typeof body.youtubeUrl === "string") {
    youtubeId = extractVideoId(body.youtubeUrl) ?? "";
  }
  if (!youtubeId) {
    return err("invalid_request", "youtubeId or youtubeUrl is required", 400);
  }

  if (!isSupportedLanguage(body.baseLanguage)) {
    return err("invalid_base_language", "baseLanguage must be one of he, ar, en", 400);
  }

  const title = typeof body.title === "string" ? body.title.trim() || null : null;

  try {
    const quiz = await createQuizForVideo(auth.client, {
      youtubeId,
      baseLanguage: body.baseLanguage,
      title,
    });
    return NextResponse.json({ quiz }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}

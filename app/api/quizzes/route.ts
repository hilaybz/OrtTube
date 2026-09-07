import { NextResponse, type NextRequest } from "next/server";
import { createQuizForVideo } from "@/lib/quiz";
import { isSupportedLanguage } from "@/lib/lang";
import { extractVideoId } from "@/lib/youtube";
import { err, handleError, requireAuth } from "./http";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  let body: {
    youtubeId?: unknown;
    youtubeUrl?: unknown;
    baseLanguage?: unknown;
    title?: unknown;
    timeRestricted?: unknown;
    durationMinutes?: unknown;
  };
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

  const timeRestricted = body.timeRestricted === true;
  if (timeRestricted && (typeof body.durationMinutes !== "number" || body.durationMinutes <= 0)) {
    return err("invalid_duration", "durationMinutes must be a positive number when timeRestricted is true", 400);
  }
  const durationMinutes = timeRestricted ? (body.durationMinutes as number) : null;

  try {
    const quiz = await createQuizForVideo(auth.client, {
      youtubeId,
      baseLanguage: body.baseLanguage,
      title,
      timeRestricted,
      durationMinutes,
    });
    return NextResponse.json({ quiz }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}

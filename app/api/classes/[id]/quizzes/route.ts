import { NextResponse, type NextRequest } from "next/server";
import { assignQuizToClass, listClassQuizzes, type TutorMode } from "@/lib/classes";
import { err, handleError, requireAuth } from "../../http";

/**
 * /api/classes/[id]/quizzes  (assignment)
 *   GET  → the class's assigned (non-deleted) quizzes with delivery settings.
 *   POST → assign a quiz { quizId, tutorMode?, maxAttempts? } and best-effort
 *          eager-translate into the class language.
 */

const TUTOR_MODES: TutorMode[] = ["off", "hints", "full"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  try {
    const quizzes = await listClassQuizzes(auth.client, id);
    return NextResponse.json({ quizzes });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  let body: { quizId?: unknown; tutorMode?: unknown; maxAttempts?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err("invalid_request", "Body must be JSON", 400);
  }

  const quizId = typeof body.quizId === "string" ? body.quizId : "";
  if (!quizId) return err("invalid_request", "quizId is required", 400);

  let tutorMode: TutorMode | undefined;
  if (body.tutorMode !== undefined) {
    if (!TUTOR_MODES.includes(body.tutorMode as TutorMode)) {
      return err("invalid_tutor_mode", "tutorMode must be off, hints or full", 400);
    }
    tutorMode = body.tutorMode as TutorMode;
  }

  // maxAttempts: omitted → default 1; explicit null → unlimited; else a positive int.
  let maxAttempts: number | null | undefined;
  if (body.maxAttempts !== undefined) {
    if (body.maxAttempts === null) {
      maxAttempts = null;
    } else if (
      typeof body.maxAttempts === "number" &&
      Number.isInteger(body.maxAttempts) &&
      body.maxAttempts >= 1
    ) {
      maxAttempts = body.maxAttempts;
    } else {
      return err("invalid_max_attempts", "maxAttempts must be null or an integer >= 1", 400);
    }
  }

  try {
    // Fire-and-forget the translation in this request-scoped server context so the
    // assignment responds immediately; the reader path re-fills lazily if needed.
    const result = await assignQuizToClass(
      auth.client,
      { classId: id, quizId, tutorMode, maxAttempts },
      { awaitTranslation: false }
    );
    return NextResponse.json({ assignment: result }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}

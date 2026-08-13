import { NextResponse, type NextRequest } from "next/server";
import { assignQuizToClass, listClassQuizzes, type TutorMode } from "@/lib/classes";
import { err, handleError, isValidIsoOrNull, requireAuth } from "../../http";

/**
 * /api/classes/[id]/quizzes  (assignment)
 *   GET  → the class's assigned (non-deleted) quizzes with delivery settings.
 *   POST → assign a quiz { quizId, tutorMode?, maxAttempts?, published?,
 *          availableFrom?, availableUntil? } and best-effort eager-translate
 *          into the class language. `published` defaults to true (unchanged
 *          instant-visibility behaviour); pass false to assign as a draft.
 *          `availableFrom`/`availableUntil` default to no window; either may
 *          be `null` explicitly or omitted.
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

  let body: {
    quizId?: unknown;
    tutorMode?: unknown;
    maxAttempts?: unknown;
    published?: unknown;
    availableFrom?: unknown;
    availableUntil?: unknown;
  };
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

  let published: boolean | undefined;
  if (body.published !== undefined) {
    if (typeof body.published !== "boolean") {
      return err("invalid_request", "published must be a boolean", 400);
    }
    published = body.published;
  }

  let availableFrom: string | null | undefined;
  if (body.availableFrom !== undefined) {
    if (!isValidIsoOrNull(body.availableFrom)) {
      return err("invalid_request", "availableFrom must be null or an ISO date string", 400);
    }
    availableFrom = body.availableFrom as string | null;
  }

  let availableUntil: string | null | undefined;
  if (body.availableUntil !== undefined) {
    if (!isValidIsoOrNull(body.availableUntil)) {
      return err("invalid_request", "availableUntil must be null or an ISO date string", 400);
    }
    availableUntil = body.availableUntil as string | null;
  }

  try {
    // Fire-and-forget the translation in this request-scoped server context so the
    // assignment responds immediately; the reader path re-fills lazily if needed.
    const result = await assignQuizToClass(
      auth.client,
      { classId: id, quizId, tutorMode, maxAttempts, published, availableFrom, availableUntil },
      { awaitTranslation: false }
    );
    return NextResponse.json({ assignment: result }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}

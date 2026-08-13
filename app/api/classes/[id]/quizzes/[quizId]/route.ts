import { NextResponse, type NextRequest } from "next/server";
import {
  setClassQuizPublished,
  setClassQuizSchedule,
  unassignQuiz,
} from "@/lib/classes";
import { err, handleError, isValidIsoOrNull, requireAuth } from "../../../http";

/**
 * DELETE /api/classes/[id]/quizzes/[quizId]  (unassign a quiz from a class).
 * Idempotent; past attempts in the class survive.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; quizId: string }> }
) {
  const { id, quizId } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  try {
    await unassignQuiz(auth.client, id, quizId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * PATCH /api/classes/[id]/quizzes/[quizId]
 *   { published?: boolean; availableFrom?: string | null; availableUntil?: string | null }
 *
 * Flip an existing assignment's published state and/or replace its
 * scheduling window, independent of re-assigning (tutor_mode / max_attempts
 * are untouched by either). Both may be present in one request — each
 * dispatches to its own single-purpose RPC (`set_class_quiz_published`,
 * `set_class_quiz_schedule`).
 *
 * `set_class_quiz_schedule` REPLACES the whole window, not a partial update —
 * same convention as tutor_mode/max_attempts always being resent in full on
 * edit — so `availableFrom` and `availableUntil` must be supplied TOGETHER
 * whenever either is touched. Sending only one would silently null out the
 * other bound, so that's rejected rather than guessed at.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; quizId: string }> }
) {
  const { id, quizId } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  let body: {
    published?: unknown;
    availableFrom?: unknown;
    availableUntil?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err("invalid_request", "Body must be JSON", 400);
  }

  const hasPublished = body.published !== undefined;
  const touchesFrom = body.availableFrom !== undefined;
  const touchesUntil = body.availableUntil !== undefined;
  const hasSchedule = touchesFrom || touchesUntil;

  if (!hasPublished && !hasSchedule) {
    return err(
      "invalid_request",
      "At least one of published, availableFrom, availableUntil is required",
      400
    );
  }
  if (hasSchedule && !(touchesFrom && touchesUntil)) {
    return err(
      "invalid_request",
      "availableFrom and availableUntil must be supplied together — the schedule is replaced as a whole, so sending only one would silently clear the other",
      400
    );
  }
  if (hasPublished && typeof body.published !== "boolean") {
    return err("invalid_request", "published must be a boolean", 400);
  }
  if (touchesFrom && !isValidIsoOrNull(body.availableFrom)) {
    return err("invalid_request", "availableFrom must be null or an ISO date string", 400);
  }
  if (touchesUntil && !isValidIsoOrNull(body.availableUntil)) {
    return err("invalid_request", "availableUntil must be null or an ISO date string", 400);
  }

  try {
    if (hasPublished) {
      await setClassQuizPublished(auth.client, id, quizId, body.published as boolean);
    }
    if (hasSchedule) {
      await setClassQuizSchedule(auth.client, id, quizId, {
        availableFrom: body.availableFrom as string | null,
        availableUntil: body.availableUntil as string | null,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { listQuizAllocations, bulkAssignQuizToClasses } from "@/lib/allocations";
import type { TutorMode } from "@/lib/classes";
import { err, handleError, isValidIsoOrNull, requireAuth } from "../../../classes/http";

/**
 * /api/quizzes/[id]/allocations  (the quiz-side mirror of
 * /api/classes/[id]/quizzes — this reads/writes by quiz instead of by class)
 *
 *   GET  → every allocation of this quiz, any state (draft/scheduled/live/
 *          done) — the editor's allocation-management list. Owner-checked by
 *          `list_quiz_allocations` itself.
 *   POST → bulk-assign to several classes at once with one shared settings
 *          object: { classIds: string[], tutorMode?, maxAttempts?,
 *          published?, availableFrom?, availableUntil? }. Each class becomes
 *          its own independent allocation (loops the same
 *          `assign_quiz_to_class` RPC the single-class flow uses). Partial
 *          failure is possible — one bad class id doesn't block the rest —
 *          so the response reports `assigned`/`failed` rather than a single
 *          pass/fail, at HTTP 200 (the request itself succeeded).
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
    const allocations = await listQuizAllocations(auth.client, id);
    return NextResponse.json({ allocations });
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
    classIds?: unknown;
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

  if (
    !Array.isArray(body.classIds) ||
    body.classIds.length === 0 ||
    !body.classIds.every((c) => typeof c === "string" && c.length > 0)
  ) {
    return err("invalid_request", "classIds must be a non-empty array of strings", 400);
  }
  const classIds = body.classIds as string[];

  let tutorMode: TutorMode | undefined;
  if (body.tutorMode !== undefined) {
    if (!TUTOR_MODES.includes(body.tutorMode as TutorMode)) {
      return err("invalid_tutor_mode", "tutorMode must be off, hints or full", 400);
    }
    tutorMode = body.tutorMode as TutorMode;
  }

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

  if (body.availableFrom !== undefined && !isValidIsoOrNull(body.availableFrom)) {
    return err("invalid_request", "availableFrom must be null or an ISO date string", 400);
  }
  if (body.availableUntil !== undefined && !isValidIsoOrNull(body.availableUntil)) {
    return err("invalid_request", "availableUntil must be null or an ISO date string", 400);
  }

  try {
    const result = await bulkAssignQuizToClasses(auth.client, {
      quizId: id,
      classIds,
      tutorMode,
      maxAttempts,
      published,
      availableFrom: body.availableFrom as string | null | undefined,
      availableUntil: body.availableUntil as string | null | undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    return handleError(e);
  }
}

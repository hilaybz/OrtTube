import { NextResponse, type NextRequest } from "next/server";
import { cloneQuiz, listSharedQuizzes } from "@/lib/sharing";
import { err, handleError, requireAuth } from "./http";

/**
 * /api/quizzes/share  (sharing & clone)
 *   GET  → the caller's same-school shared-quiz catalog (browse surface).
 *   POST → clone a readable quiz { sourceQuizId } into a new private copy;
 *          responds { quizId } for the new quiz.
 *
 * Both require an authenticated teacher; the underlying SECURITY DEFINER RPCs
 * enforce teacher-only shared reads and the same-school clone gate.
 */

export async function GET() {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  try {
    const quizzes = await listSharedQuizzes(auth.client);
    return NextResponse.json({ quizzes });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  let body: { sourceQuizId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err("invalid_request", "Body must be JSON", 400);
  }

  const sourceQuizId =
    typeof body.sourceQuizId === "string" ? body.sourceQuizId : "";
  if (!sourceQuizId) {
    return err("invalid_request", "sourceQuizId is required", 400);
  }

  try {
    const quizId = await cloneQuiz(auth.client, sourceQuizId);
    return NextResponse.json({ quizId }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}

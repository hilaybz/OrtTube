import { type NextRequest, NextResponse } from "next/server";
import { getTutorQuestionsPage } from "@/lib/analytics";
import { err, handleError, requireAuth } from "../http";

/**
 * GET /api/analytics/tutor-questions?student=&quiz=&class=&limit=&offset=
 *
 * A page of the teacher-facing tutor-question log (`tutor_questions_page`),
 * scoped by any combination of student / quiz / class. At least one scope is
 * required, and every scope supplied must be one the caller owns — the RPC
 * asserts each of them and answers `not_owner` (→ 403) otherwise, so this
 * handler only has to reject the no-scope case up front.
 *
 * The response carries the page's `rows` and `total` (what the paging hook
 * needs) plus `quiz_filters` / `class_filters` for the whole scope, so the
 * filter dropdown can only ever offer values that actually have rows.
 */
function positiveInt(raw: string | null, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  const params = req.nextUrl.searchParams;
  const studentId = params.get("student") || undefined;
  const quizId = params.get("quiz") || undefined;
  const classId = params.get("class") || undefined;

  if (!studentId && !quizId && !classId) {
    return err(
      "invalid_args",
      "at least one of student, quiz or class is required",
      400
    );
  }

  try {
    const page = await getTutorQuestionsPage(
      auth.client,
      { studentId, quizId, classId },
      {
        limit: positiveInt(params.get("limit"), 10),
        offset: positiveInt(params.get("offset"), 0),
      }
    );
    return NextResponse.json(page);
  } catch (e) {
    return handleError(e);
  }
}

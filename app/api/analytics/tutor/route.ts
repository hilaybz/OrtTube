import { type NextRequest, NextResponse } from "next/server";
import { getTutorStats } from "@/lib/analytics";
import { err, handleError, requireAuth } from "../http";

/**
 * GET /api/analytics/tutor?quizId=... | classId=...  (teacher tutor analytics)
 *
 * Tutor-interaction stats for EXACTLY ONE scope — a quiz or a class — flagging
 * likely answer-extraction attempts (`tutor_stats`). Teacher-authed; the RPC is
 * owner-checked for the given scope and raises `invalid_args` (→ 400) unless
 * exactly one of quizId/classId is supplied. This route enforces the same
 * one-of rule up front.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  const quizId = req.nextUrl.searchParams.get("quizId");
  const classId = req.nextUrl.searchParams.get("classId");
  if ((quizId && classId) || (!quizId && !classId)) {
    return err("invalid_args", "exactly one of quizId or classId is required", 400);
  }

  try {
    const stats = await getTutorStats(
      auth.client,
      quizId ? { quizId } : { classId: classId as string }
    );
    return NextResponse.json({ stats });
  } catch (e) {
    return handleError(e);
  }
}

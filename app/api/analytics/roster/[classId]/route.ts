import { type NextRequest, NextResponse } from "next/server";
import {
  getClassRosterProgress,
  getStudentQuizProgress,
} from "@/lib/analyticsProgress";
import { handleError, requireAuth } from "../../http";

/**
 * GET /api/analytics/roster/[classId]            (per-student class progress)
 * GET /api/analytics/roster/[classId]?student=…  (single-student drill-down)
 *
 * Teacher-facing roster analytics: each current member's progress and scores
 * across the class's assigned, non-deleted quizzes, plus a class summary. With a
 * `student` query param it returns that one student's full per-quiz attempt list
 * instead. Teacher-authed via the caller's SSR client; the RPCs deny non-owners
 * (`not_owner` → 403).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const { classId } = await params;
  const studentId = req.nextUrl.searchParams.get("student");

  const auth = await requireAuth();
  if (auth.response) return auth.response;

  try {
    const progress = studentId
      ? await getStudentQuizProgress(auth.client, classId, studentId)
      : await getClassRosterProgress(auth.client, classId);
    return NextResponse.json({ progress });
  } catch (e) {
    return handleError(e);
  }
}

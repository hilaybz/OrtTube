import { type NextRequest, NextResponse } from "next/server";
import { getClassQuizAnalytics } from "@/lib/analytics";
import { handleError, requireAuth } from "../../../../http";

/**
 * GET /api/analytics/class/[classId]/quiz/[quizId]  (teacher, per-class quiz analytics)
 *
 * The one quiz's analytics WITHIN this one class — score distribution and
 * per-question/per-option breakdown scored from each student's latest
 * completed attempt (`class_quiz_analytics`). Teacher-authed; the RPC denies
 * a non-owner (`not_owner` → 403) before checking the quiz is actually
 * assigned to the class (`not_assigned` → 404), so the two can't be told
 * apart by a caller who doesn't own the class.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ classId: string; quizId: string }> }
) {
  const { classId, quizId } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  try {
    const analytics = await getClassQuizAnalytics(auth.client, classId, quizId);
    return NextResponse.json({ analytics });
  } catch (e) {
    return handleError(e);
  }
}

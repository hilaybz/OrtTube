import { type NextRequest, NextResponse } from "next/server";
import { getQuizStats, getQuestionStats } from "@/lib/analytics";
import { handleError, requireAuth } from "../../http";

/**
 * GET /api/analytics/quiz/[quizId]  (teacher quiz analytics)
 *
 * Combined payload: `{ stats, questions }` — quiz-level completion/attempt/score
 * summary (`quiz_stats`) plus the per-question correct% + distractor
 * distribution (`question_stats`). Teacher-authed; both RPCs deny non-owners
 * (`not_owner` → 403). Owner-facing, so the answer key / base text in
 * `question_stats` is intentionally exposed here (never on a student path).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ quizId: string }> }
) {
  const { quizId } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  try {
    const [stats, questions] = await Promise.all([
      getQuizStats(auth.client, quizId),
      getQuestionStats(auth.client, quizId),
    ]);
    return NextResponse.json({ stats, questions });
  } catch (e) {
    return handleError(e);
  }
}

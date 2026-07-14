import { type NextRequest, NextResponse } from "next/server";
import { getAttemptReview } from "@/lib/attempts";
import { handleError, requireAuth } from "../../http";

/**
 * GET /api/attempts/[attemptId]/review  (reveal-gated review)
 *
 * Student-authed. The RPC enforces that the attempt belongs to `auth.uid()` and
 * applies the reveal gate: per-question correctness / correct options /
 * explanations are returned ONLY when no retake remains; otherwise the response
 * carries the aggregate score only. The answer key never leaks while attempts
 * are left.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  const { attemptId } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  try {
    const review = await getAttemptReview(auth.client, attemptId);
    return NextResponse.json({ review });
  } catch (e) {
    return handleError(e);
  }
}

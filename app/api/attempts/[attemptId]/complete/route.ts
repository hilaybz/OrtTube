import { type NextRequest, NextResponse } from "next/server";
import { completeAttempt } from "@/lib/attempts";
import { handleError, requireAuth } from "../../http";

/**
 * POST /api/attempts/[attemptId]/complete  (finalize)
 *
 * Stamps completion and returns the aggregate score (num_correct /
 * num_questions) computed from the answer + question snapshots. Idempotent.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  const { attemptId } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  try {
    const summary = await completeAttempt(auth.client, attemptId);
    return NextResponse.json({ summary });
  } catch (e) {
    return handleError(e);
  }
}

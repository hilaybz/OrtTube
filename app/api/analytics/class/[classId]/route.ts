import { type NextRequest, NextResponse } from "next/server";
import { getClassStats } from "@/lib/analytics";
import { handleError, requireAuth } from "../../http";

/**
 * GET /api/analytics/class/[classId]  (teacher class analytics)
 *
 * Per-assigned-quiz stats for the class: attempt-based averages/completion
 * (anonymized attempts still count) plus a separate current-roster coverage
 * figure (`class_stats`). Teacher-authed; the RPC denies non-owners
 * (`not_owner` → 403).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const { classId } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  try {
    const stats = await getClassStats(auth.client, classId);
    return NextResponse.json({ stats });
  } catch (e) {
    return handleError(e);
  }
}

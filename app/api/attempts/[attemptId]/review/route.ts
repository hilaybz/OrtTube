import { type NextRequest, NextResponse } from "next/server";
import { getAttemptReview } from "@/lib/attempts";
import { handleError, requireAuth } from "../../http";

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

import { NextResponse } from "next/server";
import { listMyQuizAllocationTags } from "@/lib/allocations";
import { handleError, requireAuth } from "../../classes/http";

/**
 * GET /api/quizzes/allocations
 *
 * The caller's own quizzes that have at least one allocation, split into
 * `live`/`scheduled` class tags — mirrors `/api/classes/assigned`'s no-id,
 * scoped-to-caller shape. Feeds the `זמין:` / `מתוזמן:` chips on both the
 * library page (backlog 1.5) and the dashboard landing section.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  try {
    const allocations = await listMyQuizAllocationTags(auth.client);
    return NextResponse.json({ allocations });
  } catch (e) {
    return handleError(e);
  }
}

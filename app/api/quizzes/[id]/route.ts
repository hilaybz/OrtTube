import { NextResponse, type NextRequest } from "next/server";
import { softDeleteQuiz } from "@/lib/quiz";
import { handleError, requireAuth } from "../http";

/**
 * DELETE /api/quizzes/[id]  (quiz authoring — soft delete)
 *
 * Marks the quiz `deleted_at` via `soft_delete_quiz`, which removes it from the
 * teacher's library and from the school catalog while leaving attempts, answers
 * and analytics intact — a quiz a class has already played is history, not
 * something to erase.
 *
 * Ownership is enforced inside the RPC (`_assert_quiz_owner`), so this handler
 * deliberately does not re-check it: the rule holds for any caller, and a
 * duplicate check here could only drift from the one that actually binds.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  const { id: quizId } = await params;

  try {
    await softDeleteQuiz(auth.client, quizId);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return handleError(e);
  }
}

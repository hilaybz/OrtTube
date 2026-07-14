import { NextResponse, type NextRequest } from "next/server";
import { unassignQuiz } from "@/lib/classes";
import { handleError, requireAuth } from "../../../http";

/**
 * DELETE /api/classes/[id]/quizzes/[quizId]  (unassign a quiz from a class).
 * Idempotent; past attempts in the class survive.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; quizId: string }> }
) {
  const { id, quizId } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  try {
    await unassignQuiz(auth.client, id, quizId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

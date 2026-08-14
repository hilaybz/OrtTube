import { NextResponse, type NextRequest } from "next/server";
import { getQuizForPreview } from "@/lib/sharing";
import { handleError, requireAuth } from "../../share/http";

/**
 * GET /api/quizzes/[id]/preview  (backlog 1.3 / issue #13)
 *
 * Full read of a quiz the caller may READ — their own, or a `shared` quiz in
 * their school — including the answer key and explanations, for the
 * catalog's preview-before-cloning flow. Same gate as `clone_quiz`/`POST
 * /api/quizzes/share`, so this shares that route's HTTP plumbing
 * (`SharingError` → uniform error envelope) rather than the `[id]/*`
 * authoring routes' (`QuizError`-based) one.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  const { id: quizId } = await params;

  try {
    const quiz = await getQuizForPreview(auth.client, quizId);
    return NextResponse.json({ quiz });
  } catch (e) {
    return handleError(e);
  }
}

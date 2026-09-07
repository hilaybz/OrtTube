import { NextResponse, type NextRequest } from "next/server";
import { getQuizForPreview } from "@/lib/sharing";
import { handleError, requireAuth } from "../../share/http";

/**
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

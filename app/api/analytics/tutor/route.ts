import { type NextRequest, NextResponse } from "next/server";
import { getTutorStats } from "@/lib/analytics";
import { err, handleError, requireAuth } from "../http";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  const quizId = req.nextUrl.searchParams.get("quizId");
  const classId = req.nextUrl.searchParams.get("classId");
  if ((quizId && classId) || (!quizId && !classId)) {
    return err("invalid_args", "exactly one of quizId or classId is required", 400);
  }

  try {
    const stats = await getTutorStats(
      auth.client,
      quizId ? { quizId } : { classId: classId as string }
    );
    return NextResponse.json({ stats });
  } catch (e) {
    return handleError(e);
  }
}

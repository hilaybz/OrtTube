import { type NextRequest, NextResponse } from "next/server";
import {
  getClassRosterProgress,
  getStudentQuizProgress,
} from "@/lib/analyticsProgress";
import { handleError, requireAuth } from "../../http";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const { classId } = await params;
  const studentId = req.nextUrl.searchParams.get("student");

  const auth = await requireAuth();
  if (auth.response) return auth.response;

  try {
    const progress = studentId
      ? await getStudentQuizProgress(auth.client, classId, studentId)
      : await getClassRosterProgress(auth.client, classId);
    return NextResponse.json({ progress });
  } catch (e) {
    return handleError(e);
  }
}

import { type NextRequest, NextResponse } from "next/server";
import { startOrResumeAttempt } from "@/lib/attempts";
import { err, handleError, requireAuth } from "./http";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  let body: { classId?: unknown; quizId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err("invalid_request", "Body must be JSON", 400);
  }

  const classId = typeof body.classId === "string" ? body.classId : "";
  const quizId = typeof body.quizId === "string" ? body.quizId : "";
  if (!classId || !quizId) {
    return err("invalid_request", "classId and quizId are required", 400);
  }

  try {
    const attempt = await startOrResumeAttempt(auth.client, classId, quizId);
    return NextResponse.json(
      { attempt },
      { status: attempt.resumed ? 200 : 201 }
    );
  } catch (e) {
    return handleError(e);
  }
}

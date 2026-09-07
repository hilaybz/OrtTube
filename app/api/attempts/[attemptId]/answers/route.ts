import { type NextRequest, NextResponse } from "next/server";
import { submitAnswer } from "@/lib/attempts";
import { err, handleError, requireAuth } from "../../http";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  const { attemptId } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  let body: { questionId?: unknown; optionIds?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err("invalid_request", "Body must be JSON", 400);
  }

  const questionId = typeof body.questionId === "string" ? body.questionId : "";
  if (!questionId) {
    return err("invalid_request", "questionId is required", 400);
  }
  if (
    !Array.isArray(body.optionIds) ||
    !body.optionIds.every((o) => typeof o === "string")
  ) {
    return err("invalid_request", "optionIds must be an array of strings", 400);
  }
  const optionIds = body.optionIds as string[];

  try {
    const result = await submitAnswer(
      auth.client,
      attemptId,
      questionId,
      optionIds
    );
    return NextResponse.json({ result });
  } catch (e) {
    return handleError(e);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { upsertQuestion, type OptionInput } from "@/lib/quiz";
import { err, handleError, requireAuth } from "../../http";

/**
 * POST /api/quizzes/[id]/questions  (quiz authoring — upsert a question)
 *
 * Body: { questionId?, kind, positionSeconds, orderIndex, basePrompt,
 *         baseExplanation?, options: [{ option_id?, is_correct, order_index,
 *         base_text }], source? }. Creates a new question (questionId omitted) or
 *         edits an existing one in place. Teacher-authed; ownership + the
 *         answer-key invariants (>=1 correct, exactly one for `single`) are
 *         enforced by `upsert_question`. Returns the question id.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: quizId } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  let body: {
    questionId?: unknown;
    kind?: unknown;
    positionSeconds?: unknown;
    orderIndex?: unknown;
    basePrompt?: unknown;
    baseExplanation?: unknown;
    options?: unknown;
    source?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err("invalid_request", "Body must be JSON", 400);
  }

  if (body.kind !== "single" && body.kind !== "multi") {
    return err("invalid_request", "kind must be 'single' or 'multi'", 400);
  }
  if (typeof body.positionSeconds !== "number" || !Number.isFinite(body.positionSeconds)) {
    return err("invalid_request", "positionSeconds must be a number", 400);
  }
  if (typeof body.orderIndex !== "number" || !Number.isInteger(body.orderIndex)) {
    return err("invalid_request", "orderIndex must be an integer", 400);
  }
  if (typeof body.basePrompt !== "string" || body.basePrompt.trim().length === 0) {
    return err("invalid_request", "basePrompt is required", 400);
  }
  if (!Array.isArray(body.options) || body.options.length === 0) {
    return err("invalid_request", "options must be a non-empty array", 400);
  }

  const options: OptionInput[] = [];
  for (const raw of body.options) {
    const o = raw as {
      option_id?: unknown;
      is_correct?: unknown;
      order_index?: unknown;
      base_text?: unknown;
    };
    if (
      typeof o.is_correct !== "boolean" ||
      typeof o.order_index !== "number" ||
      !Number.isInteger(o.order_index) ||
      typeof o.base_text !== "string"
    ) {
      return err(
        "invalid_request",
        "each option needs { is_correct:boolean, order_index:int, base_text:string }",
        400
      );
    }
    options.push({
      option_id: typeof o.option_id === "string" ? o.option_id : undefined,
      is_correct: o.is_correct,
      order_index: o.order_index,
      base_text: o.base_text,
    });
  }

  const source = body.source === "generated" ? "generated" : "authored";

  try {
    const questionId = await upsertQuestion(auth.client, {
      quizId,
      questionId: typeof body.questionId === "string" ? body.questionId : null,
      kind: body.kind,
      positionSeconds: body.positionSeconds,
      orderIndex: body.orderIndex,
      basePrompt: body.basePrompt,
      baseExplanation:
        typeof body.baseExplanation === "string" ? body.baseExplanation : null,
      options,
      source,
    });
    return NextResponse.json({ questionId }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}

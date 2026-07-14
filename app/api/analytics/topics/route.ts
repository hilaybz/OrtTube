import { type NextRequest, NextResponse } from "next/server";
import { getTopicClusters } from "@/lib/analyticsTopics";
import { ClusterError } from "@/lib/ai/clusterQuestions";
import { isSupportedLanguage, type Language } from "@/lib/lang";
import { err, handleError, requireAuth } from "../http";

/**
 * GET /api/analytics/topics?quizId=... | classId=...  (teacher topic-cluster analytic)
 *
 * "Most-asked-questions → topic clusters": pulls the students' tutor prompts for
 * EXACTLY ONE scope (a quiz or a class) via the owner-checked
 * `tutor_prompts_in_scope` RPC, then has Claude cluster them into topics with a
 * count, example prompts, and a teaching recommendation each.
 *
 * Teacher-authed; the RPC is owner-checked (a non-owner raises `not_owner` → 403
 * via the shared analytics mapping). Clusters are written in `?lang=` (he|ar|en,
 * default Hebrew). The empty case (no prompts in scope) returns 200 with an empty
 * cluster list and never calls the model. A malformed model response maps to 502.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  const quizId = req.nextUrl.searchParams.get("quizId");
  const classId = req.nextUrl.searchParams.get("classId");
  if ((quizId && classId) || (!quizId && !classId)) {
    return err("invalid_args", "exactly one of quizId or classId is required", 400);
  }

  const langParam = req.nextUrl.searchParams.get("lang");
  const language: Language = isSupportedLanguage(langParam) ? langParam : "he";

  try {
    const result = await getTopicClusters(
      auth.client,
      quizId ? { quizId } : { classId: classId as string },
      language
    );
    return NextResponse.json({ topics: result });
  } catch (e) {
    if (e instanceof ClusterError) {
      return err("ai_error", "The clustering model returned an unusable response", 502);
    }
    return handleError(e);
  }
}

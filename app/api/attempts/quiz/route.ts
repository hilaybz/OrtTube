import { type NextRequest, NextResponse } from "next/server";
import { getQuizForStudent } from "@/lib/attempts";
import { ensureTranslation } from "@/lib/quiz";
import type { Language } from "@/lib/lang";
import { err, handleError, requireAuth } from "../http";

/**
 * GET /api/attempts/quiz?classId=..&quizId=..  (answer-free student read)
 *
 * The only path by which a student sees a quiz. Text is resolved to the
 * student's language server-side; `is_correct` is never returned. Membership and
 * assignment are enforced inside the RPC.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  const classId = req.nextUrl.searchParams.get("classId") ?? "";
  const quizId = req.nextUrl.searchParams.get("quizId") ?? "";
  if (!classId || !quizId) {
    return err("invalid_request", "classId and quizId are required", 400);
  }

  try {
    const quiz = await getQuizForStudent(auth.client, classId, quizId, {
      // When the class-language translation is incomplete, the read falls back to
      // base per-row AND enqueues a lazy re-fill (single-flight via
      // translation_jobs) so a lost eager translation is eventually recovered.
      // Fire-and-forget: never delay or fail the student read on translation.
      onIncompleteTranslation: (qId: string, lang: Language) => {
        void ensureTranslation(qId, lang).catch(() => {
          // best-effort: a failed re-fill just means another base fallback later.
        });
      },
    });
    return NextResponse.json({ quiz });
  } catch (e) {
    return handleError(e);
  }
}

import { QuizError } from "@/lib/quiz";
import { err, requireAuth } from "../http";

/**
 * Shared HTTP plumbing for the `/api/quizzes/*` authoring route handlers.
 *
 * Uniform error envelope `{ error: { code, message } }` and a single
 * mapping from the stable RPC/service error codes to HTTP status, so every route
 * reports the same code the DB raised. The authoring RPCs run through the
 * caller's AUTHENTICATED client so `auth.uid()` resolves to the owner.
 */

export { err, requireAuth };

/** Map a stable QuizError code to an HTTP status. */
export function statusForCode(code: string): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "not_owner":
    case "not_authorized":
    case "quiz_deleted":
      return 403;
    case "quiz_not_found":
    case "question_not_found":
    case "option_not_found":
      return 404;
    case "invalid_base_language":
    case "invalid_duration":
    case "invalid_kind":
    case "invalid_source":
    case "invalid_visibility":
    case "no_options":
    case "single_needs_exactly_one_correct":
    case "needs_at_least_one_correct":
    case "cannot_remove_last_correct":
      return 400;
    default:
      return 400;
  }
}

/** Translate a thrown QuizError into the uniform JSON response. */
export function handleError(e: unknown) {
  if (e instanceof QuizError) {
    return err(e.code, e.message, statusForCode(e.code));
  }
  return err("internal_error", "Unexpected error", 500);
}

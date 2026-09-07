import { AttemptError } from "@/lib/attempts";
import { err, requireAuth } from "../http";

export { err, requireAuth };

export function statusForCode(code: string): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "not_member":
    case "not_your_attempt":
      return 403;
    case "not_assigned":
    case "quiz_not_found":
    case "attempt_not_found":
    case "question_not_in_attempt":
      return 404;
    case "no_attempts_left":
    case "already_answered":
    case "attempt_completed":
    case "window_closed":
      return 409;
    case "invalid_selection_count":
    case "invalid_option":
    case "invalid_request":
      return 400;
    default:
      return 400;
  }
}

export function handleError(e: unknown) {
  if (e instanceof AttemptError) {
    return err(e.code, e.message, statusForCode(e.code));
  }
  return err("internal_error", "Unexpected error", 500);
}

import { ClassError } from "@/lib/classes";
import { err, requireAuth } from "../http";

export { err, requireAuth };

export function statusForCode(code: string): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "not_owner":
    case "not_authorized":
    case "cross_school":
    case "is_teacher":
    case "quiz_forbidden":
      return 403;
    case "class_not_found":
    case "quiz_not_found":
    case "not_assigned":
      return 404;
    case "invalid_email":
    case "invalid_tutor_mode":
    case "invalid_max_attempts":
    case "invalid_schedule_window":
      return 400;
    default:
      return 400;
  }
}

export function handleError(e: unknown) {
  if (e instanceof ClassError) {
    return err(e.code, e.message, statusForCode(e.code));
  }
  return err("internal_error", "Unexpected error", 500);
}

/**
 * Validate a nullable ISO-timestamp body field (a scheduling window bound):
 * `null` is valid (clears the bound); anything else must be a string `Date`
 * can parse. Used by every route accepting `availableFrom`/`availableUntil`.
 */
export function isValidIsoOrNull(value: unknown): boolean {
  if (value === null) return true;
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

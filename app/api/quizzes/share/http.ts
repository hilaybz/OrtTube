import { SharingError } from "@/lib/sharing";
import { err, requireAuth } from "../../http";

/**
 * Shared HTTP plumbing for the `/api/quizzes/share` route handlers.
 *
 * Uniform error envelope `{ error: { code, message } }` and a single
 * mapping from the stable RPC/service error codes to HTTP status, so the route
 * reports the same code the DB raised.
 */

export { err, requireAuth };

/** Map a stable SharingError code to an HTTP status. */
export function statusForCode(code: string): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "not_authorized":
    case "quiz_deleted":
      return 403;
    case "quiz_not_found":
      return 404;
    default:
      return 400;
  }
}

/** Translate a thrown SharingError into the uniform JSON response. */
export function handleError(e: unknown) {
  if (e instanceof SharingError) {
    return err(e.code, e.message, statusForCode(e.code));
  }
  return err("internal_error", "Unexpected error", 500);
}

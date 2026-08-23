import { AnalyticsError } from "@/lib/analytics";
import { err, requireAuth } from "../http";

/**
 * Shared HTTP plumbing for the `/api/analytics/*` route handlers.
 *
 * Uniform error envelope `{ error: { code, message } }`. The analytics RPCs are
 * owner-checked; they raise `not_owner` for a non-owner or unknown target, and
 * `invalid_args` for the scope rule of `tutor_stats`. `AnalyticsError.code`
 * carries that stable code, so map on it directly.
 */

export { err, requireAuth };

/** Map a stable AnalyticsError code to an HTTP status. */
export function statusForCode(code: string): number {
  switch (code) {
    case "not_owner":
      return 403;
    case "not_assigned":
      return 404;
    case "invalid_args":
      return 400;
    default:
      return 400;
  }
}

/** Translate a thrown AnalyticsError into the uniform JSON response. */
export function handleError(e: unknown) {
  if (e instanceof AnalyticsError) {
    return err(e.code, e.message, statusForCode(e.code));
  }
  return err("internal_error", "Unexpected error", 500);
}

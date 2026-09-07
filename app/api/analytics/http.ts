import { AnalyticsError } from "@/lib/analytics";
import { err, requireAuth } from "../http";

export { err, requireAuth };

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

export function handleError(e: unknown) {
  if (e instanceof AnalyticsError) {
    return err(e.code, e.message, statusForCode(e.code));
  }
  return err("internal_error", "Unexpected error", 500);
}

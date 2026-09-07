import { SharingError } from "@/lib/sharing";
import { err, requireAuth } from "../../http";

export { err, requireAuth };

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

export function handleError(e: unknown) {
  if (e instanceof SharingError) {
    return err(e.code, e.message, statusForCode(e.code));
  }
  return err("internal_error", "Unexpected error", 500);
}

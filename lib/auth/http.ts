/**
 * Small JSON response helpers so every auth endpoint returns the stable
 * `{ error: { code, message } }` shape.
 */
import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "invalid_request"
  | "no_invite"
  | "ambiguous_school"
  | "email_taken"
  | "signup_failed"
  | "invalid_credentials"
  | "no_profile"
  | "deactivated"
  | "lookup_failed"
  | "unauthorized"
  | "server_misconfigured"
  | "school_not_found"
  | "seed_failed";

export function jsonError(
  code: ApiErrorCode,
  message: string,
  status: number
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

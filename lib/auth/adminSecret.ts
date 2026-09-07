/**
 * ADMIN_SECRET guard for destructive admin endpoints (seed-teacher, and
 * delete-user). Kept separate from CRON_SECRET so a leaked cron secret can't
 * create teachers or delete users.
 */
import { timingSafeEqual } from "node:crypto";
import { jsonError } from "./http";
import type { NextResponse } from "next/server";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual requires equal-length buffers; length mismatch is a definite
  // non-match, but still compare against a same-length buffer to avoid leaking it.
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function assertAdminSecret(req: Request): NextResponse | null {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) {
    return jsonError(
      "server_misconfigured",
      "ADMIN_SECRET is not configured on the server.",
      500
    );
  }

  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token || !safeEqual(token, expected)) {
    return jsonError(
      "unauthorized",
      "Missing or invalid admin secret.",
      401
    );
  }

  return null;
}

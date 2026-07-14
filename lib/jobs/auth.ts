import { timingSafeEqual } from "node:crypto";

/**
 * Which shared secret an endpoint is guarded by.
 *
 * - `"cron"`  → scheduled jobs under `/api/jobs/*` (checked against `CRON_SECRET`).
 * - `"admin"` → destructive admin endpoints (`/api/admin/seed-teacher`,
 *               `/api/admin/delete-user`), checked against `ADMIN_SECRET`.
 *
 * Two separate secrets so a leaked cron secret cannot create teachers or delete
 * users.
 */
export type SecretKind = "cron" | "admin";

const ENV_VAR: Record<SecretKind, string> = {
  cron: "CRON_SECRET",
  admin: "ADMIN_SECRET",
};

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Constant-time string comparison that never short-circuits on length. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual requires equal-length buffers; comparing against a fixed-size
  // digest keeps the comparison constant-time regardless of input length.
  if (a.length !== b.length) {
    // Still burn a comparison to avoid leaking length via timing.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Verify the `Authorization: Bearer <secret>` header of an incoming request
 * against the configured secret for `which`.
 *
 * Returns `null` when the request is authorized (caller proceeds). Returns a
 * ready-to-send `Response` otherwise:
 *   - `500` `server_misconfigured` if the expected secret env var is not set.
 *   - `401` `unauthorized`         if the header is missing/malformed/mismatched.
 *
 * Usage in a Route Handler:
 *   const denied = assertSecret(req, "cron");
 *   if (denied) return denied;
 */
export function assertSecret(req: Request, which: SecretKind): Response | null {
  const expected = process.env[ENV_VAR[which]];
  if (!expected) {
    return jsonError(
      "server_misconfigured",
      `${ENV_VAR[which]} is not configured`,
      500
    );
  }

  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return jsonError("unauthorized", "Missing or malformed Authorization header", 401);
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token || !secretsMatch(token, expected)) {
    return jsonError("unauthorized", "Invalid credentials", 401);
  }

  return null;
}

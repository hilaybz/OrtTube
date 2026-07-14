/**
 * POST /api/auth/sign-in
 *
 * Role-agnostic sign-in with post-auth routing + deactivation gate. One endpoint,
 * one form; the client never supplies a role.
 *
 * Flow:
 *   1. Authenticate with email/password via the SSR (anon) client — this sets the
 *      session cookie so the browser is signed in.
 *   2. Read `profiles.role` / `deactivated_at` via the service client. Role is
 *      read from the profile row, never from user-supplied auth metadata.
 *   3. If deactivated (or no profile) -> sign back out (clear the cookie) and reject.
 *   4. Else return the target route (teacher -> /dashboard, student -> /student).
 *      The redirect itself is consumed by the frontend later.
 *
 * Body: { email, password }
 * Success: 200 { route, role }
 */
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/auth/serviceClient";
import { evaluateSignIn } from "@/lib/auth/signIn";
import { jsonError, jsonOk } from "@/lib/auth/http";

interface SignInBody {
  email?: unknown;
  password?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as SignInBody | null;
  if (!body) {
    return jsonError("invalid_request", "Request body must be valid JSON.", 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return jsonError("invalid_request", "email and password are required.", 400);
  }

  // 1. Authenticate (sets the session cookie via the SSR client).
  const supabase = await createClient();
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authErr || !authData?.user) {
    return jsonError("invalid_credentials", "Invalid email or password.", 401);
  }

  // 2. Read role + deactivation via the service client (authoritative).
  const service = createServiceClient();
  const evaluation = await evaluateSignIn(service, authData.user.id);

  // 3. Handle a negative evaluation.
  if (!evaluation.ok) {
    // A transient profile-lookup failure is NOT a permission decision: keep the
    // session intact (the profile may exist) and surface 503 so the user can
    // retry, rather than signing a legitimate user out over a DB blip.
    if (evaluation.code === "lookup_failed") {
      return jsonError(evaluation.code, evaluation.message, 503);
    }
    // Deactivated / missing profile -> sign back out and reject (403).
    await supabase.auth.signOut();
    return jsonError(evaluation.code, evaluation.message, 403);
  }

  // 4. Return the target route for the frontend to consume.
  return jsonOk({ route: evaluation.route, role: evaluation.role }, 200);
}

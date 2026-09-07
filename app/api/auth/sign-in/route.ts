/**
 *   2. Read `profiles.role` / `deactivated_at` via the service client. Role is
 *      read from the profile row, never from user-supplied auth metadata.
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

  const supabase = await createClient();
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authErr || !authData?.user) {
    return jsonError("invalid_credentials", "Invalid email or password.", 401);
  }

  const service = createServiceClient();
  const evaluation = await evaluateSignIn(service, authData.user.id);

  if (!evaluation.ok) {
    // A transient profile-lookup failure is NOT a permission decision: keep the
    // session intact (the profile may exist) and surface 503 so the user can
    // retry, rather than signing a legitimate user out over a DB blip.
    if (evaluation.code === "lookup_failed") {
      return jsonError(evaluation.code, evaluation.message, 503);
    }
    await supabase.auth.signOut();
    return jsonError(evaluation.code, evaluation.message, 403);
  }

  return jsonOk({ route: evaluation.route, role: evaluation.role }, 200);
}

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/auth/serviceClient";
import { evaluateSignIn } from "@/lib/auth/signIn";

/**
 * Email-confirmation / OAuth callback (v2).
 *
 * Exchanges the `code` for a session, then routes by the authoritative
 * `profiles.role` via the same evaluation the sign-in endpoint uses (never
 * `user_metadata`). Deactivated / profile-less users are signed back out.
 * All failures land on the home page ("/") — the dedicated auth screens are
 * rebuilt in the frontend pass.
 */
/**
 * Only honor `next` when it is a SAFE same-origin relative path: it must start
 * with a single "/" and not "//" (protocol-relative) and carry no scheme — this
 * blocks open redirects like `//evil.com` or `https://evil.com`. Anything else
 * falls back to the role's default route.
 */
function safeNextPath(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/")) return null; // must be relative to our origin
  if (next.startsWith("//")) return null; // protocol-relative → foreign host
  if (/^\/\\/.test(next)) return null; // "/\" is treated as "//" by browsers
  return next;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=confirmation_failed`);
  }

  const supabase = await createClient();
  const { data: authData, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !authData?.user) {
    return NextResponse.redirect(`${origin}/?error=confirmation_failed`);
  }

  const evaluation = await evaluateSignIn(createServiceClient(), authData.user.id);
  if (!evaluation.ok) {
    // A transient lookup failure must NOT destroy the session — the profile may
    // exist. Redirect to an error without signing out so a retry can succeed.
    if (evaluation.code === "lookup_failed") {
      return NextResponse.redirect(`${origin}/?error=lookup_failed`);
    }
    // Genuine negative decisions (no profile / deactivated) sign the user out.
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/?error=${evaluation.code}`);
  }

  return NextResponse.redirect(`${origin}${next ?? evaluation.route}`);
}

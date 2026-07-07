import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Role comes from auth metadata; accounts created before roles existed
  // are teachers.
  const isSignedIn = Boolean(user?.email);
  const isStudent = isSignedIn && user?.user_metadata?.role === "student";

  function redirectTo(target: string) {
    const redirectResponse = NextResponse.redirect(new URL(target, request.url));
    supabaseResponse.cookies.getAll().forEach((c) => {
      redirectResponse.cookies.set(c.name, c.value, c);
    });
    return redirectResponse;
  }

  if (path.startsWith("/dashboard")) {
    if (!isSignedIn) return redirectTo("/auth/sign-in");
    if (isStudent) return redirectTo("/student");
  }

  if (path.startsWith("/student")) {
    if (!isSignedIn) return redirectTo("/auth/sign-in");
    if (!isStudent) return redirectTo("/dashboard");
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

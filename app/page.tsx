import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/profile";

/**
 * The root path is a router, not a screen. Accounts are provisioned by the
 * school, so there is nothing to market and no second audience path to offer —
 * a signed-out visitor belongs on the sign-in screen, and a signed-in one on
 * the home of their role.
 */
export default async function Home() {
  const profile = await getMyProfile(await createClient());
  if (profile?.role === "teacher") redirect("/dashboard");
  if (profile?.role === "student") redirect("/student");
  redirect("/sign-in");
}

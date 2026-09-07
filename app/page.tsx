import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/profile";

export default async function Home() {
  const profile = await getMyProfile(await createClient());
  if (profile?.role === "teacher") redirect("/dashboard");
  if (profile?.role === "student") redirect("/student");
  redirect("/sign-in");
}

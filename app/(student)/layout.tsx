import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/profile";
import { AppShell } from "@/components/shell/AppShell";
import type { NavItem } from "@/components/shell/Sidebar";

const NAV: ReadonlyArray<NavItem> = [
  { href: "/student", label: "הפיד", icon: "grid" },
  { href: "/student/settings", label: "הגדרות", icon: "settings" },
];

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getMyProfile(await createClient());
  if (!profile) redirect("/sign-in");
  if (profile.role !== "student") redirect("/dashboard");
  return <AppShell nav={NAV}>{children}</AppShell>;
}

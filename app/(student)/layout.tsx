import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/profile";
import { AppShell } from "@/components/shell/AppShell";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/components/shell/sidebarCollapse";
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
  // Read server-side so a collapsed rail renders collapsed on first paint.
  const collapsed =
    (await cookies()).get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1";
  return (
    <AppShell nav={NAV} initialCollapsed={collapsed}>
      {children}
    </AppShell>
  );
}

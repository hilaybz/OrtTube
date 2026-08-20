import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/profile";
import { AppShell } from "@/components/shell/AppShell";
import type { NavItem } from "@/components/shell/Sidebar";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/components/shell/sidebarCollapse";

const NAV: ReadonlyArray<NavItem> = [
  { href: "/dashboard", label: "סקירה", icon: "grid" },
  { href: "/dashboard/quizzes", label: "החידונים שלי", icon: "book" },
  { href: "/dashboard/classes", label: "כיתות", icon: "class" },
  { href: "/dashboard/analytics", label: "אנליטיקה", icon: "chart" },
  { href: "/dashboard/settings", label: "הגדרות", icon: "settings" },
];

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getMyProfile(await createClient());
  if (!profile) redirect("/sign-in");
  if (profile.role !== "teacher") redirect("/student");
  // Render the sidebar at its persisted width on the first paint rather than
  // letting the client correct it after hydration.
  const collapsed =
    (await cookies()).get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1";
  return (
    <AppShell nav={NAV} initialCollapsed={collapsed}>
      {children}
    </AppShell>
  );
}

import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listMyClasses, type ClassRow } from "@/lib/classes";
import { GlassCard } from "@/components/ui/GlassCard";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/ui/Icon";

/**
 * Analytics home: the teacher's classes as glass cards linking to each class's
 * analytics screen. Reads go through `@/lib` with the caller's session (RLS).
 */
export default async function AnalyticsHomePage() {
  const client = (await createClient()) as unknown as SupabaseClient;

  let classes: ClassRow[] = [];
  let failed = false;
  try {
    classes = await listMyClasses(client);
  } catch {
    failed = true;
  }

  return (
    <div className="mx-auto max-w-6xl py-2">
      <h1 className="mb-1 text-3xl font-bold tracking-tight">אנליטיקה</h1>
      <p className="mb-6 text-[var(--body)]">
        בחרו כיתה כדי לראות התקדמות תלמידים, השלמות וניתוח הנושאים שנשאלו.
      </p>

      {failed ? (
        <Alert variant="danger" title="לא ניתן לטעון את הכיתות">
          אירעה שגיאה בטעינת הכיתות שלך. נסו לרענן את הדף.
        </Alert>
      ) : classes.length === 0 ? (
        <GlassCard>
          <p className="text-[var(--body)]">
            עדיין אין לך כיתות. לאחר יצירת כיתה והקצאת חידונים, האנליטיקה תופיע כאן.
          </p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c) => (
            <Link
              key={c.id}
              href={`/dashboard/analytics/${c.id}`}
              className="group block focus-visible:outline-none"
            >
              <GlassCard interactive className="flex h-full items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 className="truncate text-lg font-semibold text-[var(--heading)]">
                    {c.name}
                  </h2>
                  <span className="text-sm text-[var(--fg-brand)]">צפייה באנליטיקה</span>
                </div>
                <Icon name="chart" size={22} className="shrink-0 text-[var(--body)]" />
              </GlassCard>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

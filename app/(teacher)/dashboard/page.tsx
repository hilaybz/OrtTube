import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listMyClasses, type ClassRow } from "@/lib/classes";
import { getClassStats, type ClassStats } from "@/lib/analytics";
import { GlassCard } from "@/components/ui/GlassCard";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/ui/Icon";
import { StatTile } from "@/components/teacher/StatTile";
import { ClassCard } from "@/components/teacher/overview/ClassCard";
import {
  pct,
  summarizeClass,
  totalsFromSummaries,
} from "@/components/teacher/overview/aggregate";

/**
 * Teacher overview: a welcome header, cross-class KPI tiles, and a grid of the
 * teacher's classes linking to per-class analytics. There is no rollup RPC, so
 * totals are aggregated here by fanning out `class_stats` per class; a per-class
 * failure is skipped (its stats treated as absent) rather than sinking the page,
 * and a failure to list classes degrades to a friendly Alert. Reads run through
 * the caller's session so RLS applies.
 */
export default async function DashboardPage() {
  const client = (await createClient()) as unknown as SupabaseClient;

  let classes: ClassRow[] = [];
  let listFailed = false;
  try {
    classes = await listMyClasses(client);
  } catch {
    listFailed = true;
  }

  // Fan out per-class stats; each read is isolated so one owner/transient error
  // degrades that class to "no stats" instead of failing the whole dashboard.
  const perClassStats: (ClassStats | null)[] = await Promise.all(
    classes.map(async (c) => {
      try {
        return await getClassStats(client, c.id);
      } catch {
        return null;
      }
    })
  );

  const summaries = classes.map((c, i) => summarizeClass(c, perClassStats[i]));
  const totals = totalsFromSummaries(summaries, perClassStats);

  const header = (
    <>
      <h1 className="mb-1 text-3xl font-bold tracking-tight">סקירה</h1>
      <p className="mb-6 text-[var(--body)]">
        מבט־על על הכיתות, החידונים והביצועים שלך.
      </p>
    </>
  );

  if (listFailed) {
    return (
      <div className="mx-auto max-w-6xl py-2">
        {header}
        <Alert variant="danger" title="לא ניתן לטעון את הנתונים">
          אירעה שגיאה בטעינת הכיתות שלך. נסו לרענן את הדף.
        </Alert>
      </div>
    );
  }

  if (classes.length === 0) {
    return (
      <div className="mx-auto max-w-6xl py-2">
        {header}
        <GlassCard className="flex flex-col items-start gap-4">
          <p className="text-[var(--body)]">
            עדיין אין לך כיתות. צרו כיתה כדי להתחיל להקצות חידונים ולעקוב אחר
            ההתקדמות.
          </p>
          <Link
            href="/dashboard/classes"
            className="inline-flex items-center gap-2 rounded-[var(--radius)] bg-[var(--brand)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-strong)]"
          >
            <Icon name="class" size={16} />
            צרו כיתה כדי להתחיל
          </Link>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl py-2">
      {header}

      <div className="flex flex-col gap-8">
        <section>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="כיתות" value={totals.classCount} />
            <StatTile label="תלמידים" value={totals.studentCount} />
            <StatTile label="השלמות חידונים" value={totals.completions} />
            <StatTile
              label="ציון ממוצע"
              value={pct(totals.avgScore)}
              hint="ממוצע משוקלל על פני כל ההשלמות"
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-[var(--heading)]">
            הכיתות שלי
          </h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {summaries.map((s) => (
              <ClassCard key={s.id} summary={s} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

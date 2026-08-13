import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listMyClasses, type ClassRow } from "@/lib/classes";
import { getClassStats, type ClassStats } from "@/lib/analytics";
import { listMyQuizzes, type MyQuiz } from "@/lib/quiz";
import { listMyQuizAllocationTags, type QuizAllocationTags } from "@/lib/allocations";
import { GlassCard } from "@/components/ui/GlassCard";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/ui/Icon";
import { StatTile } from "@/components/teacher/StatTile";
import { QuizCard } from "@/components/teacher/QuizCard";
import { ClassCard } from "@/components/teacher/overview/ClassCard";
import {
  pct,
  summarizeClass,
  totalsFromSummaries,
} from "@/components/teacher/overview/aggregate";

/**
 * Teacher overview: a welcome header, cross-class KPI tiles, the quizzes
 * currently in play, and a grid of the teacher's classes linking to per-class
 * analytics. There is no rollup RPC, so totals are aggregated here by fanning
 * out `class_stats` per class; a per-class failure is skipped (its stats
 * treated as absent) rather than sinking the page, and a failure to list
 * classes degrades to a friendly Alert. Reads run through the caller's
 * session so RLS applies.
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

  // Quizzes that are actually live or scheduled to at least one class right
  // now. `listMyQuizAllocationTags` also returns an entry for a quiz whose
  // allocations are all drafts/closed (both arrays empty, for the library's
  // "לא פעיל" badge) — that's the wrong inclusion test for a section titled
  // "active", so this filters on the arrays themselves rather than mere
  // presence in the map. A closed-window quiz is deliberately absent here
  // too — see the deferred "quiz finished" issue.
  // Isolated the same way class stats are: a failure here degrades to an
  // empty section rather than sinking the whole overview.
  let allocatedQuizzes: { quiz: MyQuiz; tags: QuizAllocationTags }[] = [];
  try {
    const [myQuizzes, tags] = await Promise.all([
      listMyQuizzes(client),
      listMyQuizAllocationTags(client),
    ]);
    const tagsByQuizId = new Map(tags.map((t) => [t.quiz_id, t]));
    allocatedQuizzes = myQuizzes
      .map((q) => ({ quiz: q, tags: tagsByQuizId.get(q.quiz_id) }))
      .filter(
        (
          entry
        ): entry is { quiz: MyQuiz; tags: QuizAllocationTags } =>
          !!entry.tags &&
          (entry.tags.live.length > 0 || entry.tags.scheduled.length > 0)
      );
  } catch {
    allocatedQuizzes = [];
  }

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
            החידונים הפעילים שלי
          </h2>
          {allocatedQuizzes.length === 0 ? (
            <GlassCard>
              <p className="text-[var(--body)]">
                עדיין לא הקציתם חידון לאף כיתה.{" "}
                <Link
                  href="/dashboard/quizzes"
                  className="font-medium text-[var(--fg-brand)] underline hover:no-underline"
                >
                  עברו לספריית החידונים
                </Link>{" "}
                כדי להקצות אחד.
              </p>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {allocatedQuizzes.map(({ quiz, tags }) => (
                <QuizCard key={quiz.quiz_id} quiz={quiz} tags={tags} />
              ))}
            </div>
          )}
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

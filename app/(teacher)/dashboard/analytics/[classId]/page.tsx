import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listMyClasses } from "@/lib/classes";
import { getClassStats, type ClassStats } from "@/lib/analytics";
import {
  getClassRosterProgress,
  type ClassRosterProgress,
} from "@/lib/analyticsProgress";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/ui/Icon";
import { StatTile } from "@/components/teacher/StatTile";
import { RosterTable } from "@/components/teacher/RosterTable";
import { TopicClusters } from "@/components/teacher/TopicClusters";

/** Render a 0..1 fraction as a whole-percent string, or an em dash when null. */
function pct(fraction: number | null): string {
  return fraction == null ? "—" : `${Math.round(fraction * 100)}%`;
}

const HEAD_CELL =
  "whitespace-nowrap px-4 py-3 text-start text-sm font-medium text-[var(--body)]";
const CELL = "whitespace-nowrap px-4 py-4 text-sm tabular-nums";

/**
 * Per-class analytics: headline stat tiles, a per-quiz breakdown table, a
 * per-student roster progress grid, and the on-demand topic-cluster analytic.
 * Every server read is wrapped so an owner (or transient) error degrades to a
 * friendly Alert instead of crashing the screen.
 */
export default async function ClassAnalyticsPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const client = (await createClient()) as unknown as SupabaseClient;

  let className: string | null = null;
  try {
    const classes = await listMyClasses(client);
    className = classes.find((c) => c.id === classId)?.name ?? null;
  } catch {
    // Non-fatal: fall back to a generic heading.
  }

  let stats: ClassStats | null = null;
  let statsFailed = false;
  try {
    stats = await getClassStats(client, classId);
  } catch {
    statsFailed = true;
  }

  let roster: ClassRosterProgress | null = null;
  let rosterFailed = false;
  try {
    roster = await getClassRosterProgress(client, classId);
  } catch {
    rosterFailed = true;
  }

  const backLink = (
    <Link
      href="/dashboard/analytics"
      className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-[var(--fg-brand)]"
    >
      <Icon name="arrow" size={16} />
      חזרה לאנליטיקה
    </Link>
  );

  const header = (
    <>
      {backLink}
      <h1 className="mb-1 text-3xl font-bold tracking-tight">
        אנליטיקה — {className ?? "כיתה"}
      </h1>
    </>
  );

  // Without the class stats there is nothing meaningful to show.
  if (statsFailed || !stats) {
    return (
      <div className="mx-auto max-w-6xl py-2">
        {header}
        <Alert variant="danger" title="לא ניתן לטעון את נתוני הכיתה">
          ייתכן שהכיתה אינה קיימת או שאין לך הרשאה לצפות בה. נסו לחזור לרשימת
          הכיתות.
        </Alert>
      </div>
    );
  }

  const activeQuizzes = stats.quizzes.filter((q) => !q.deleted);
  const summary = roster?.summary;
  const completionRate =
    summary && summary.possible_completions > 0
      ? summary.quizzes_completed_total / summary.possible_completions
      : null;

  return (
    <div className="mx-auto max-w-6xl py-2">
      {header}
      <p className="mb-6 text-[var(--body)]">
        התקדמות התלמידים והחידונים בכיתה זו.
      </p>

      <div className="flex flex-col gap-8">
        {/* Headline tiles */}
        <section>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="תלמידים בכיתה" value={stats.current_member_count} />
            <StatTile
              label="חידונים שהוקצו"
              value={summary?.total_assigned ?? activeQuizzes.length}
            />
            {summary && (
              <StatTile
                label="שיעור השלמה"
                value={pct(completionRate)}
                hint={`${summary.quizzes_completed_total}/${summary.possible_completions} השלמות`}
              />
            )}
            {summary && (
              <StatTile label="ציון ממוצע" value={pct(summary.average_best_score)} />
            )}
          </div>
        </section>

        {/* Per-quiz breakdown */}
        <section>
          <h2 className="mb-3 text-xl font-semibold text-[var(--heading)]">
            לפי חידון
          </h2>
          {activeQuizzes.length === 0 ? (
            <div className="glass p-5">
              <p className="text-[var(--body)]">
                עדיין לא הוקצו חידונים לכיתה זו.
              </p>
            </div>
          ) : (
            <div className="glass">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-start">
                  <caption className="sr-only">סטטיסטיקה לכל חידון בכיתה</caption>
                  <thead>
                    <tr className="border-b border-[var(--glass-border-subtle)]">
                      <th scope="col" className={HEAD_CELL}>
                        חידון
                      </th>
                      <th scope="col" className={HEAD_CELL}>
                        ניסיונות
                      </th>
                      <th scope="col" className={HEAD_CELL}>
                        השלמות
                      </th>
                      <th scope="col" className={HEAD_CELL}>
                        כיסוי כיתה
                      </th>
                      <th scope="col" className={HEAD_CELL}>
                        ציון ממוצע
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeQuizzes.map((q, i) => {
                      const last = i === activeQuizzes.length - 1;
                      return (
                        <tr
                          key={q.quiz_id}
                          className={
                            last
                              ? ""
                              : "border-b border-[var(--glass-border-subtle)]"
                          }
                        >
                          <th
                            scope="row"
                            className="whitespace-nowrap px-4 py-4 text-start font-medium text-[var(--heading)]"
                          >
                            {q.title ?? `חידון ${i + 1}`}
                          </th>
                          <td className={`${CELL} text-[var(--body)]`}>
                            {q.attempt_count}
                          </td>
                          <td className={`${CELL} text-[var(--body)]`}>
                            {q.completion_count}
                          </td>
                          <td className={`${CELL} text-[var(--body)]`}>
                            {q.members_completed}/{q.current_member_count}
                          </td>
                          <td
                            className={`${CELL} font-medium text-[var(--heading)]`}
                          >
                            {pct(q.average_score)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* Per-student roster progress */}
        <section>
          <h2 className="mb-3 text-xl font-semibold text-[var(--heading)]">
            התקדמות תלמידים
          </h2>
          {rosterFailed || !roster ? (
            <Alert variant="warning" title="לא ניתן לטעון את התקדמות התלמידים">
              נתוני החידונים נטענו, אך טעינת התקדמות התלמידים נכשלה. נסו לרענן
              את הדף.
            </Alert>
          ) : (
            <RosterTable roster={roster} />
          )}
        </section>

        {/* On-demand topic clustering */}
        <section>
          <h2 className="mb-1 text-xl font-semibold text-[var(--heading)]">
            נושאים שנשאלו
          </h2>
          <p className="mb-3 text-sm text-[var(--body)]">
            ניתוח AI של השאלות שהתלמידים שאלו את המורה־AI, מקובצות לנושאים עם
            המלצות הוראה.
          </p>
          <TopicClusters classId={classId} />
        </section>
      </div>
    </div>
  );
}

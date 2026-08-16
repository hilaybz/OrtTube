import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getClassQuizAnalytics, type ClassQuizAnalytics } from "@/lib/analytics";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/ui/Icon";
import { StatTile } from "@/components/teacher/StatTile";
import { ScoreDistribution } from "@/components/teacher/analytics/ScoreDistribution";
import { QuestionBreakdown } from "@/components/teacher/analytics/QuestionBreakdown";

/** Render a 0..1 fraction as a whole-percent string, or an em dash when null. */
function pct(fraction: number | null): string {
  return fraction == null ? "—" : `${Math.round(fraction * 100)}%`;
}

/**
 * One quiz's analytics WITHIN one class: headline stat tiles, a score
 * distribution, and a per-question/per-option breakdown — all scored from
 * each student's latest completed attempt (`class_quiz_analytics`), never
 * best-of and never every retake, so this always agrees with the grade a
 * student is shown on their own results page.
 */
export default async function ClassQuizAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string; quizId: string }>;
}) {
  const { id: classId, quizId } = await params;
  const client = (await createClient()) as unknown as SupabaseClient;

  let analytics: ClassQuizAnalytics | null = null;
  let failed = false;
  try {
    analytics = await getClassQuizAnalytics(client, classId, quizId);
  } catch {
    failed = true;
  }

  const backLink = (
    <Link
      href={`/dashboard/classes/${classId}`}
      className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-[var(--fg-brand)]"
    >
      <Icon name="arrow" size={16} />
      חזרה לכיתה
    </Link>
  );

  if (failed || !analytics) {
    return (
      <div className="mx-auto max-w-4xl py-2">
        {backLink}
        <h1 className="mb-1 text-3xl font-bold tracking-tight">אנליטיקת חידון</h1>
        <Alert variant="danger" title="לא ניתן לטעון את נתוני החידון">
          ייתכן שהחידון אינו מוקצה לכיתה זו או שאין לך הרשאה לצפות בו. נסו לחזור
          לכיתה.
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl py-2">
      {backLink}
      <h1 className="mb-1 text-3xl font-bold tracking-tight">
        {analytics.title ?? "אנליטיקת חידון"}
      </h1>
      <p className="mb-6 text-[var(--body)]">ביצועי הכיתה בחידון זה.</p>

      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label="תלמידים שסיימו"
            value={analytics.students_completed}
            hint={`מתוך ${analytics.member_count} בכיתה`}
          />
          <StatTile label="ניסיונות" value={analytics.attempt_count} />
          <StatTile label="ציון ממוצע" value={pct(analytics.average_score)} />
          <StatTile label="שאלות" value={analytics.question_count} />
        </div>

        <ScoreDistribution
          buckets={analytics.score_distribution}
          studentsCompleted={analytics.students_completed}
        />

        <section>
          <h2 className="mb-3 text-xl font-semibold text-[var(--heading)]">
            לפי שאלה
          </h2>
          <QuestionBreakdown questions={analytics.questions} />
        </section>
      </div>
    </div>
  );
}

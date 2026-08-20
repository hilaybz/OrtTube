import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getClassQuizAnalytics, type ClassQuizAnalytics } from "@/lib/analytics";
import { Alert } from "@/components/ui/Alert";
import { BackLink } from "@/components/ui/BackLink";
import { MetricRow, MetricTile } from "@/components/teacher/analytics/MetricTile";
import { ClassQuizCharts } from "@/components/teacher/analytics/ClassQuizCharts";
import { QuestionBreakdown } from "@/components/teacher/analytics/QuestionBreakdown";
import { grade } from "@/components/teacher/analytics/chartTheme";

/**
 * One quiz's analytics WITHIN one class — the per-(class, quiz) view the hub's
 * class table and the student table both link into, and the deepest analytics
 * screen in the product.
 *
 * Everything here is scored from each student's LATEST completed attempt
 * (`class_quiz_analytics`), never best-of and never every retake, so it always
 * agrees with the grade a student is shown on their own results page — and with
 * the class view one level up, which uses the same basis.
 *
 * The back affordance names the class's analytics view rather than the class
 * page: this is an analytics screen, and a reader who drilled in from either
 * place is looking for the level above THIS number, not for wherever their
 * browser history happens to point.
 */
export default async function ClassQuizAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string; quizId: string }>;
}) {
  const { id: classId, quizId } = await params;
  const client = (await createClient()) as unknown as SupabaseClient;

  let analytics: ClassQuizAnalytics | null = null;
  try {
    analytics = await getClassQuizAnalytics(client, classId, quizId);
  } catch {
    analytics = null;
  }

  const back = (
    <BackLink
      href={`/dashboard/analytics?scope=class&id=${classId}`}
      label="אנליטיקה של הכיתה"
    />
  );

  if (!analytics) {
    return (
      <div className="mx-auto max-w-4xl py-2">
        <header className="mb-4 flex flex-col gap-2">
          {back}
          <h1 className="text-3xl font-bold tracking-tight">אנליטיקת חידון</h1>
        </header>
        <Alert variant="danger" title="לא ניתן לטעון את נתוני החידון">
          ייתכן שהחידון אינו מוקצה לכיתה זו או שאין לך הרשאה לצפות בו.
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl py-2">
      <header className="mb-6 flex flex-col gap-2">
        {back}
        <h1 className="text-3xl font-bold tracking-tight">
          {analytics.title ?? "אנליטיקת חידון"}
        </h1>
        <p className="text-[var(--body)]">ביצועי הכיתה בחידון זה.</p>
      </header>

      <div className="flex flex-col gap-8">
        <MetricRow>
          <MetricTile
            label="תלמידים שסיימו"
            value={analytics.students_completed}
            hint={`מתוך ${analytics.member_count} בכיתה`}
            icon="checkCircle"
          />
          <MetricTile
            label="ציון ממוצע"
            value={grade(analytics.average_score)}
            hint="מתוך 100"
            icon="percent"
          />
          <MetricTile
            label="שאלות"
            value={analytics.question_count}
            icon="quiz"
          />
          <MetricTile
            label="הגשות"
            value={analytics.completion_count}
            hint="כולל ניסיונות חוזרים"
            icon="checkCircle"
          />
        </MetricRow>

        <ClassQuizCharts data={analytics} />

        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-[var(--heading)]">
            לפי שאלה
          </h2>
          <QuestionBreakdown questions={analytics.questions} />
        </section>
      </div>
    </div>
  );
}

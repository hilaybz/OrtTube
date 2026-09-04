import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getClassQuizAnalytics, type ClassQuizAnalytics } from "@/lib/analytics";
import { listMyClassesRunningQuiz } from "@/lib/classes";
import { analyticsCutoffNote } from "@/lib/analyticsCutoff";
import { Alert } from "@/components/ui/Alert";
import { GlassCard } from "@/components/ui/GlassCard";
import { MetricRow, MetricTile } from "./MetricTile";
import { ClassQuizCharts } from "./ClassQuizCharts";
import { ClassQuizClassSwitcher } from "./ClassQuizClassSwitcher";
import { QuestionBreakdown } from "./QuestionBreakdown";
import { grade } from "./chartTheme";

/**
 * One quiz's analytics WITHIN one class — the deepest analytics screen in the
 * product, and the view the class table, the student table and the overview all
 * drill into.
 *
 * It hangs off the CLASS scope (`?scope=class&id=<class>&quiz=<quiz>`) rather
 * than the quiz's, because that is where its permission lives: the numbers come
 * from `class_quiz_analytics`, which gates on teaching the class, while the
 * quiz's own view is author-only. A teacher running a colleague's shared quiz
 * can read this and not that, so addressing it as a facet of the quiz would deny
 * the very readers who reach it most.
 *
 * Everything here is scored from each student's LATEST completed attempt, never
 * best-of and never every retake, so it always agrees with the grade a student
 * is shown on their own results page — and with the class view one level up,
 * which uses the same basis.
 */
export async function ClassQuizAnalyticsView({
  classId,
  quizId,
}: {
  classId: string;
  quizId: string;
}) {
  const client = (await createClient()) as unknown as SupabaseClient;

  // The switcher's options don't depend on the numbers, and a class the reader
  // can't open is already excluded from them, so a failed lookup costs the
  // affordance and nothing else.
  const [analytics, classes] = await Promise.all([
    getClassQuizAnalytics(client, classId, quizId).catch(
      () => null as ClassQuizAnalytics | null
    ),
    listMyClassesRunningQuiz(client, quizId).catch(() => []),
  ]);

  if (!analytics) {
    return (
      <Alert variant="danger" title="לא ניתן לטעון את נתוני החידון">
        ייתכן שהחידון אינו מוקצה לכיתה זו או שאין לך הרשאה לצפות בו.
      </Alert>
    );
  }

  const cutoffNote = analyticsCutoffNote(
    analytics.content_updated_at,
    analytics.excluded_attempt_count
  );

  return (
    <div className="flex flex-col gap-8">
      <GlassCard className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold text-[var(--heading)]">
            {analytics.title ?? "חידון ללא שם"}
          </h2>
          <p className="mt-1 text-sm text-[var(--body-subtle)]">
            ביצועי הכיתה בחידון זה.
          </p>
        </div>
        <ClassQuizClassSwitcher
          classId={classId}
          quizId={quizId}
          classes={classes}
        />
      </GlassCard>

      {cutoffNote && <Alert variant="warning">{cutoffNote}</Alert>}

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
        <h2 className="text-xl font-semibold text-[var(--heading)]">לפי שאלה</h2>
        <QuestionBreakdown questions={analytics.questions} />
      </section>
    </div>
  );
}

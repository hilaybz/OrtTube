import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getClassQuizAnalytics, type ClassQuizAnalytics } from "@/lib/analytics";
import { listMyClassesRunningQuiz } from "@/lib/classes";
import { analyticsCutoffNote } from "@/lib/analyticsCutoff";
import { Alert } from "@/components/ui/Alert";
import { GlassCard } from "@/components/ui/GlassCard";
import { MetricRow, MetricTile } from "./MetricTile";
import { ClassQuizCharts } from "./ClassQuizCharts";
import { QuizClassFilter } from "./QuizClassFilter";
import { QuestionBreakdown } from "./QuestionBreakdown";
import { grade } from "./chartTheme";

/**
 * One quiz's analytics WITHIN one class — the deepest analytics screen in the
 * product, and the view the class table, the student table and the overview all
 * drill into.
 *
 * The quiz view narrowed to a class (`?scope=quiz&id=<quiz>&class=<class>`), so
 * a teacher comparing how the same quiz landed in each of their classes swaps
 * one dropdown instead of navigating back out to a class each time. It is a
 * different dataset rather than a subset of the rollup: correctness per question
 * has no class dimension in `quiz_analytics_overview`, so narrowing means
 * fetching `class_quiz_analytics` and rendering it in place.
 *
 * That RPC gates on teaching the class, while the surrounding quiz view is
 * author-only — a divergence with no reachable case today, since the shared
 * library clones rather than assigns, but the reason the filter offers a
 * teacher's own classes only.
 *
 * Everything here is scored from each student's LATEST completed attempt, never
 * best-of and never every retake, so it always agrees with the grade a student
 * is shown on their own results page — and with the rollup above it, which uses
 * the same basis.
 */
export async function ClassQuizAnalyticsView({
  classId,
  quizId,
}: {
  classId: string;
  quizId: string;
}) {
  const client = (await createClient()) as unknown as SupabaseClient;

  // The filter's options don't depend on the numbers, and a class the reader
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

  // The filter already carries the class's name, so the header can say which
  // class these numbers belong to without a lookup of its own.
  const className = classes.find((c) => c.id === classId)?.name ?? null;
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
            {className ? `ביצועי ${className} בחידון זה.` : "ביצועי הכיתה בחידון זה."}
          </p>
        </div>
        <QuizClassFilter quizId={quizId} classId={classId} classes={classes} />
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

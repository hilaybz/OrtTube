import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { IconLink } from "@/components/ui/IconButton";
import { withBackTarget } from "@/components/ui/backTarget";
import {
  getClassQuizAnalytics,
  getQuizAnalyticsOverview,
  type ClassQuizAnalytics,
  type QuizAnalyticsOverview,
} from "@/lib/analytics";
import { listMyClassesRunningQuiz } from "@/lib/classes";
import { MetricRow, MetricTile } from "./MetricTile";
import { QuizCharts } from "./QuizCharts";
import { ClassQuizCharts } from "./ClassQuizCharts";
import { QuizClassFilter } from "./QuizClassFilter";
import { QuizClassTable } from "./QuizClassTable";
import { QuizQuestionTable } from "./QuizQuestionTable";
import { QuestionBreakdown } from "./QuestionBreakdown";
import { TutorQuestionLog } from "./TutorQuestionLog";
import { TutorInsights } from "./TutorInsights";
import { grade } from "./chartTheme";
import { analyticsCutoffNote } from "@/lib/analyticsCutoff";

/** "12:34" / "1:02:03" from a video duration. */
function duration(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * One quiz's analytics — across every class it runs in, or narrowed to one of
 * them by the class filter in its header.
 *
 * ONE view for both states, so narrowing reads as a filter and not as a
 * different screen: the same header card, the same four-tile row, the same
 * chart grid and the same section order, with each section's numbers recomputed
 * for the chosen class. What changes is only what a single class cannot answer
 * — the per-class comparison charts and the "by class" table are the comparison
 * itself, so they give way to the deeper per-question breakdown that only makes
 * sense once a class is fixed.
 *
 * The two payloads have different gates: the rollup is author-only, while the
 * narrowed numbers need only that the reader teaches the class. A reader who has
 * one and not the other still gets the view — the header simply drops the parts
 * that come from the rollup.
 *
 * Narrowed numbers come from each student's LATEST completed attempt, the same
 * basis as the class view and as the grade the student was shown.
 */
export async function QuizAnalyticsView({
  quizId,
  classId = null,
}: {
  quizId: string;
  /** The class the view is narrowed to, or `null` for every class. */
  classId?: string | null;
}) {
  const client = (await createClient()) as unknown as SupabaseClient;

  // The filter's options and the narrowed numbers are independent of the
  // rollup, so each failure costs only what it feeds.
  const [data, narrowed, classes] = await Promise.all([
    getQuizAnalyticsOverview(client, quizId).catch(
      () => null as QuizAnalyticsOverview | null
    ),
    classId
      ? getClassQuizAnalytics(client, classId, quizId).catch(
          () => null as ClassQuizAnalytics | null
        )
      : Promise.resolve(null),
    listMyClassesRunningQuiz(client, quizId).catch(() => []),
  ]);

  if (classId && !narrowed) {
    return (
      <Alert variant="danger" title="לא ניתן לטעון את נתוני החידון בכיתה">
        ייתכן שהחידון אינו מוקצה לכיתה זו או שאין לך הרשאה לצפות בה.
      </Alert>
    );
  }
  if (!classId && !data) {
    return (
      <Alert variant="danger" title="לא ניתן לטעון את נתוני החידון">
        ייתכן שהחידון נמחק או שאינך המחבר/ת שלו. אנליטיקה של חידון זמינה למחבר/ת בלבד.
      </Alert>
    );
  }

  const title = data?.title ?? narrowed?.title ?? null;
  const className = classes.find((c) => c.id === classId)?.name ?? null;
  const videoLength = duration(data?.video.duration_seconds ?? null);
  const cutoffNote = analyticsCutoffNote(
    (narrowed ?? data)!.content_updated_at,
    (narrowed ?? data)!.excluded_attempt_count
  );

  return (
    <div className="flex flex-col gap-8">
      <GlassCard className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold text-[var(--heading)]">
            {title ?? "חידון ללא שם"}
          </h2>
          {data && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--body-subtle)]">
              <span className="inline-flex items-center gap-1">
                <Icon name="video" size={14} />
                {data.video.title ?? "סרטון"}
              </span>
              {data.video.channel_name && (
                <span className="inline-flex items-center gap-1">
                  <Icon name="user" size={14} />
                  {data.video.channel_name}
                </span>
              )}
              {videoLength && (
                <span className="inline-flex items-center gap-1">
                  <Icon name="clock" size={14} />
                  {videoLength}
                </span>
              )}
              <Badge variant={data.visibility === "shared" ? "brand" : "gray"}>
                {data.visibility === "shared" ? "משותף" : "פרטי"}
              </Badge>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <QuizClassFilter quizId={quizId} classId={classId} classes={classes} />
          {data && (
            <IconLink
              name="edit"
              label="עריכת החידון"
              href={withBackTarget(`/dashboard/quizzes/${quizId}/edit`, "analytics")}
              tooltipPlacement="bottom"
            />
          )}
        </div>
      </GlassCard>

      {cutoffNote && <Alert variant="warning">{cutoffNote}</Alert>}

      {narrowed ? (
        <MetricRow>
          <MetricTile
            label="תלמידים בכיתה"
            value={narrowed.member_count}
            hint={className ?? undefined}
            icon="class"
          />
          <MetricTile
            label="תלמידים שסיימו"
            value={narrowed.students_completed}
            hint={`מתוך ${narrowed.member_count} בכיתה`}
            icon="checkCircle"
          />
          <MetricTile
            label="ציון ממוצע"
            value={grade(narrowed.average_score)}
            hint="מתוך 100"
            icon="percent"
          />
          <MetricTile
            label="הגשות"
            value={narrowed.completion_count}
            hint="כולל ניסיונות חוזרים"
            icon="quiz"
          />
        </MetricRow>
      ) : (
        <MetricRow>
          <MetricTile
            label="כיתות שהוקצו"
            value={data!.summary.class_count}
            hint={`${data!.summary.member_count} תלמידים`}
            icon="class"
          />
          <MetricTile
            label="תלמידים שסיימו"
            value={data!.summary.students_completed}
            icon="checkCircle"
          />
          <MetricTile
            label="ציון ממוצע"
            value={grade(data!.summary.average_score)}
            hint="מתוך 100"
            icon="percent"
          />
          <MetricTile
            label="שאלות ל-OrtAI"
            value={data!.summary.tutor_question_count}
            icon="bot"
          />
        </MetricRow>
      )}

      {narrowed ? <ClassQuizCharts data={narrowed} /> : <QuizCharts data={data!} />}

      {narrowed ? (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-xl font-semibold text-[var(--heading)]">
              לפי שאלה
            </h2>
            <p className="mt-0.5 text-sm text-[var(--body-subtle)]">
              איך הכיתה ענתה על כל שאלה, ואיזו הסחה משכה אליה תשובות.
            </p>
          </div>
          <QuestionBreakdown questions={narrowed.questions} />
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold text-[var(--heading)]">
              לפי כיתה
            </h2>
            <QuizClassTable quizId={quizId} classes={data!.classes} />
          </section>

          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-xl font-semibold text-[var(--heading)]">
                השאלות שנופלות
              </h2>
              <p className="mt-0.5 text-sm text-[var(--body-subtle)]">
                מסודרות מהשאלה שהתלמידים טועים בה יותר מכולן.
              </p>
            </div>
            <QuizQuestionTable questions={data!.questions} />
          </section>
        </>
      )}

      <section className="flex flex-col gap-4">
        {/* `tutor_prompts_in_scope` takes a quiz OR a class, never both, so the
            AI reading is offered only for the whole quiz — summarising every
            class's questions under a one-class filter would misreport them. */}
        {!narrowed && (
          <TutorInsights
            scope={{ quizId }}
            hasQuestions={data!.summary.tutor_question_count > 0}
          />
        )}
        <TutorQuestionLog
          scope={classId ? { quizId, classId } : { quizId }}
          title="השאלות שנשאלו בזמן החידון"
          showStudent
          showQuizFilter={false}
          emptyMessage={
            narrowed
              ? "עדיין לא נשאלו שאלות את OrtAI בחידון זה בכיתה."
              : "עדיין לא נשאלו שאלות את OrtAI בחידון זה."
          }
        />
      </section>
    </div>
  );
}

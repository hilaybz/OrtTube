import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { IconLink } from "@/components/ui/IconButton";
import {
  getQuizAnalyticsOverview,
  type QuizAnalyticsOverview,
} from "@/lib/analytics";
import { MetricRow, MetricTile } from "./MetricTile";
import { QuizCharts } from "./QuizCharts";
import { QuizClassTable } from "./QuizClassTable";
import { QuizQuestionTable } from "./QuizQuestionTable";
import { TutorQuestionLog } from "./TutorQuestionLog";
import { TutorInsights } from "./TutorInsights";
import { grade } from "./chartTheme";

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
 * One quiz, across every class it runs in — the rollup a quiz never had.
 *
 * The order is the order an author asks the questions in: what is this quiz and
 * where is it running, then how it lands overall, then per class, then which
 * questions fail, then what students asked OrtAI while taking it — with the AI
 * summary sitting directly above those questions, since it is a reading of
 * exactly that list.
 */
export async function QuizAnalyticsView({ quizId }: { quizId: string }) {
  const client = (await createClient()) as unknown as SupabaseClient;

  let data: QuizAnalyticsOverview | null = null;
  try {
    data = await getQuizAnalyticsOverview(client, quizId);
  } catch {
    data = null;
  }

  if (!data) {
    return (
      <Alert variant="danger" title="לא ניתן לטעון את נתוני החידון">
        ייתכן שהחידון נמחק או שאינך המחבר/ת שלו. אנליטיקה של חידון זמינה למחבר/ת בלבד.
      </Alert>
    );
  }

  const videoLength = duration(data.video.duration_seconds);

  return (
    <div className="flex flex-col gap-8">
      <GlassCard className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold text-[var(--heading)]">
            {data.title ?? "חידון ללא שם"}
          </h2>
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
        </div>
        <IconLink
          name="edit"
          label="עריכת החידון"
          href={`/dashboard/quizzes/${quizId}/edit`}
          tooltipPlacement="bottom"
        />
      </GlassCard>

      <MetricRow>
        <MetricTile
          label="כיתות שהוקצו"
          value={data.summary.class_count}
          hint={`${data.summary.member_count} תלמידים`}
          icon="class"
        />
        <MetricTile
          label="תלמידים שסיימו"
          value={data.summary.students_completed}
          icon="checkCircle"
        />
        <MetricTile
          label="ציון ממוצע"
          value={grade(data.summary.average_score)}
          hint="מתוך 100"
          icon="percent"
        />
        <MetricTile
          label="שאלות ל-OrtAI"
          value={data.summary.tutor_question_count}
          icon="bot"
        />
      </MetricRow>

      <QuizCharts data={data} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-[var(--heading)]">לפי כיתה</h2>
        <QuizClassTable quizId={quizId} classes={data.classes} />
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
        <QuizQuestionTable questions={data.questions} />
      </section>

      <section className="flex flex-col gap-4">
        <TutorInsights
          scope={{ quizId }}
          hasQuestions={data.summary.tutor_question_count > 0}
        />
        <TutorQuestionLog
          scope={{ quizId }}
          title="השאלות שנשאלו בזמן החידון"
          showStudent
          showQuizFilter={false}
          emptyMessage="עדיין לא נשאלו שאלות את OrtAI בחידון זה."
        />
      </section>
    </div>
  );
}

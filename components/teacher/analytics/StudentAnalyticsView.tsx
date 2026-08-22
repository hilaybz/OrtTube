import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/Alert";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { getStudentAnalytics, type StudentAnalytics } from "@/lib/analytics";
import type { Language } from "@/lib/lang";
import { MetricRow, MetricTile } from "./MetricTile";
import { StudentCharts } from "./StudentCharts";
import { StudentQuizTable } from "./StudentQuizTable";
import { TutorQuestionLog } from "./TutorQuestionLog";
import { grade } from "./chartTheme";

/**
 * Language names for the profile chip. Declared here rather than imported: the
 * existing copies live inside the class and editor component folders, which this
 * section does not own, and a three-entry map is not worth a cross-boundary
 * dependency.
 */
const LANGUAGE_LABELS: Record<Language, string> = {
  he: "עברית",
  ar: "العربية",
  en: "English",
};

const JOINED_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
};

/**
 * One student, across every class the viewing teacher owns.
 *
 * This is the view a per-class RPC could not give: a student in three of a
 * teacher's classes was three separate half-answers before. Identity first, then
 * the numbers, then the charts that put those numbers against the classes they
 * came from, then the questions the student asked OrtAI — which is often the
 * most useful thing on the page, because it is the student saying in their own
 * words what they did not understand.
 */
export async function StudentAnalyticsView({ studentId }: { studentId: string }) {
  const client = (await createClient()) as unknown as SupabaseClient;

  let data: StudentAnalytics | null = null;
  try {
    data = await getStudentAnalytics(client, studentId);
  } catch {
    data = null;
  }

  if (!data) {
    return (
      <Alert variant="danger" title="לא ניתן לטעון את נתוני התלמיד/ה">
        התלמיד/ה אינו/ה רשום/ה לאף אחת מהכיתות שלך, או שאין לך הרשאה לצפות בנתונים.
      </Alert>
    );
  }

  const name = data.display_name ?? data.email ?? "תלמיד/ה";
  const language = data.preferred_language
    ? LANGUAGE_LABELS[data.preferred_language]
    : null;

  return (
    <div className="flex flex-col gap-8">
      <GlassCard className="flex flex-wrap items-center gap-4">
        <Avatar name={name} size={52} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-2xl font-semibold text-[var(--heading)]">
            {name}
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--body-subtle)]">
            {data.email && (
              <span className="inline-flex items-center gap-1">
                <Icon name="mail" size={14} />
                {data.email}
              </span>
            )}
            {data.joined_at && (
              <span className="inline-flex items-center gap-1">
                <Icon name="calendar" size={14} />
                הצטרף/ה ב-
                {new Date(data.joined_at).toLocaleDateString("he-IL", JOINED_FORMAT)}
              </span>
            )}
            {language && <Badge variant="gray">{language}</Badge>}
          </p>
        </div>
        <ul className="flex flex-wrap gap-2">
          {data.classes.map((c) => (
            <li key={c.class_id}>
              <Badge variant="brand" pill>
                <Icon name="class" size={12} />
                {c.name}
              </Badge>
            </li>
          ))}
        </ul>
      </GlassCard>

      <MetricRow>
        <MetricTile
          label="חידונים שהושלמו"
          value={`${data.summary.quizzes_completed}/${data.summary.total_assigned}`}
          icon="checkCircle"
        />
        <MetricTile
          label="ציון ממוצע"
          value={grade(data.summary.average_score)}
          hint="מתוך 100"
          icon="percent"
        />
        <MetricTile
          label="ממוצע שאר התלמידים"
          value={grade(data.summary.peer_average_score)}
          hint="באותן כיתות"
          icon="users"
        />
        <MetricTile
          label="שאלות ל-OrtAI"
          value={data.summary.tutor_question_count}
          icon="bot"
        />
      </MetricRow>

      <StudentCharts data={data} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-[var(--heading)]">לפי חידון</h2>
        <StudentQuizTable quizzes={data.quizzes} />
      </section>

      <TutorQuestionLog
        scope={{ studentId }}
        title="השאלות שהתלמיד/ה שאל/ה את OrtAI"
        emptyMessage="התלמיד/ה עדיין לא שאל/ה את OrtAI."
      />
    </div>
  );
}

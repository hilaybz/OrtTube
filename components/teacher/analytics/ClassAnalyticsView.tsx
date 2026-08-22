import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/Alert";
import {
  getClassAnalyticsOverview,
  type ClassAnalyticsOverview,
} from "@/lib/analytics";
import {
  getClassRosterProgress,
  type ClassRosterProgress,
} from "@/lib/analyticsProgress";
import { allocationState } from "@/lib/allocationState";
import { RosterTable } from "@/components/teacher/RosterTable";
import { MetricRow, MetricTile } from "./MetricTile";
import { ClassCharts } from "./ClassCharts";
import { ClassQuizTable } from "./ClassQuizTable";
import { grade } from "./chartTheme";

/**
 * One class's analytics: the three counts a teacher opens this screen for, the
 * charts, the per-quiz table, and the per-student table.
 *
 * The open/finished counts are derived here with `allocationState` rather than
 * asked of SQL. That function is the product's single definition of an
 * allocation's lifecycle state — the student feed, the class page and the quiz
 * editor all read it — so deriving the counts from the same raw window fields
 * keeps this screen from being the one place that quietly disagrees about
 * whether a quiz is still open.
 *
 * Each read is wrapped on its own: losing the roster degrades one section to a
 * warning instead of taking the screen down with it.
 */
export async function ClassAnalyticsView({ classId }: { classId: string }) {
  const client = (await createClient()) as unknown as SupabaseClient;

  let overview: ClassAnalyticsOverview | null = null;
  try {
    overview = await getClassAnalyticsOverview(client, classId);
  } catch {
    overview = null;
  }

  if (!overview) {
    return (
      <Alert variant="danger" title="לא ניתן לטעון את נתוני הכיתה">
        ייתכן שהכיתה אינה קיימת או שאין לך הרשאה לצפות בה. נסו לבחור כיתה אחרת.
      </Alert>
    );
  }

  let roster: ClassRosterProgress | null = null;
  try {
    roster = await getClassRosterProgress(client, classId);
  } catch {
    roster = null;
  }

  const now = new Date();
  const openCount = overview.quizzes.filter(
    (q) => allocationState(q, now) === "live"
  ).length;
  const finishedCount = overview.quizzes.filter(
    (q) => allocationState(q, now) === "done"
  ).length;

  const editedQuizzes = overview.quizzes.filter(
    (q) => q.excluded_attempt_count > 0
  );

  return (
    <div className="flex flex-col gap-8">
      {editedQuizzes.length > 0 && (
        <Alert variant="warning">
          {editedQuizzes.length === 1
            ? `החידון "${editedQuizzes[0].title ?? "ללא כותרת"}" נערך, ולכן מוצגים לגביו רק ניסיונות שנפתחו לאחר העריכה.`
            : `${editedQuizzes.length} חידונים בכיתה זו נערכו, ולכן מוצגים לגביהם רק ניסיונות שנפתחו לאחר העריכה.`}{" "}
          תלמידים שסיימו גרסה קודמת יופיעו כמי שלא התחילו.
        </Alert>
      )}

      <MetricRow>
        <MetricTile
          label="תלמידים בכיתה"
          value={overview.member_count}
          icon="users"
        />
        <MetricTile
          label="חידונים פעילים"
          value={openCount}
          hint={`מתוך ${overview.quiz_count} שהוקצו`}
          icon="timer"
        />
        <MetricTile
          label="חידונים שהסתיימו"
          value={finishedCount}
          icon="checkCircle"
        />
        <MetricTile
          label="ציון ממוצע"
          value={grade(overview.average_score)}
          hint="מתוך 100"
          icon="percent"
        />
      </MetricRow>

      <ClassCharts data={overview} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-[var(--heading)]">לפי חידון</h2>
        <ClassQuizTable classId={classId} quizzes={overview.quizzes} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-[var(--heading)]">
          התקדמות תלמידים
        </h2>
        {roster ? (
          <RosterTable roster={roster} />
        ) : (
          <Alert variant="warning" title="לא ניתן לטעון את התקדמות התלמידים">
            נתוני החידונים נטענו, אך טעינת התקדמות התלמידים נכשלה. נסו לרענן את
            הדף.
          </Alert>
        )}
      </section>
    </div>
  );
}

"use client";

import { ChartCarousel, ChartSlide } from "./ChartCarousel";
import { ChartCard } from "./ChartCard";
import { ColumnChart } from "./ColumnChart";
import { LineChart } from "./LineChart";
import { SERIES, grade, pct } from "./chartTheme";
import type { StudentAnalytics } from "@/lib/analytics";

const STUDENT_LABEL = "התלמיד/ה";
const CLASS_LABEL = "ממוצע הכיתה";

/** Shorten a quiz title to something a category label can carry. */
function shortTitle(title: string | null, index: number): string {
  return title?.trim() || `חידון ${index + 1}`;
}

/**
 * One student's charts: how their grades have moved, and how each of those
 * grades sits against the class that took the same quiz.
 *
 * The class average is a SERIES, not a reference line, because it moves per quiz
 * — a student can be above the class on one quiz and below on the next, and that
 * crossing is the whole point of the comparison. Slot 1 is always the student
 * and slot 2 always the class, so filtering or reordering never repaints them.
 *
 * The trend chart only plots quizzes the student actually finished: drawing an
 * unfinished quiz as a zero would read as a failed quiz, which is a different
 * fact.
 */
export function StudentCharts({ data }: { data: StudentAnalytics }) {
  const completed = data.quizzes.filter((q) => q.latest_score != null);
  const trendLabels = completed.map((q, i) => shortTitle(q.title, i));
  const classes = data.classes;
  const withTutorQuestions = data.quizzes.filter((q) => q.tutor_question_count > 0);

  return (
    <ChartCarousel label="תרשימי התלמיד/ה">
      <ChartSlide>
        <ChartCard
          title="מגמת ציונים"
          hint="הציון האחרון בכל חידון, לפי סדר ההשלמה, מול ממוצע הכיתה"
          legend={[
            { label: STUDENT_LABEL, color: SERIES[0], shape: "line" },
            { label: CLASS_LABEL, color: SERIES[1], shape: "line" },
          ]}
          empty={
            completed.length < 2
              ? "צריך שני חידונים מוגמרים לפחות כדי להראות מגמה."
              : undefined
          }
          table={{
            head: ["חידון", STUDENT_LABEL, CLASS_LABEL],
            rows: completed.map((q, i) => [
              trendLabels[i],
              grade(q.latest_score),
              grade(q.class_average_score),
            ]),
          }}
        >
          <LineChart
            ariaLabel="מגמת ציונים מול ממוצע הכיתה"
            categories={trendLabels}
            max={1}
            formatValue={(v) => grade(v)}
            series={[
              {
                label: STUDENT_LABEL,
                color: SERIES[0],
                values: completed.map((q) =>
                  q.latest_score == null ? null : Number(q.latest_score)
                ),
              },
              {
                label: CLASS_LABEL,
                color: SERIES[1],
                values: completed.map((q) =>
                  q.class_average_score == null
                    ? null
                    : Number(q.class_average_score)
                ),
              },
            ]}
          />
        </ChartCard>
      </ChartSlide>

      <ChartSlide>
        <ChartCard
          title="ציון ממוצע לפי כיתה"
          hint="הממוצע של התלמיד/ה מול ממוצע הכיתה, בכל כיתה"
          legend={[
            { label: STUDENT_LABEL, color: SERIES[0] },
            { label: CLASS_LABEL, color: SERIES[1] },
          ]}
          empty={classes.length === 0 ? "התלמיד/ה אינו/ה רשום/ה לכיתה." : undefined}
          table={{
            head: ["כיתה", STUDENT_LABEL, CLASS_LABEL],
            rows: classes.map((c) => [
              c.name,
              grade(c.average_score),
              grade(c.class_average_score),
            ]),
          }}
        >
          <ColumnChart
            ariaLabel="ציון ממוצע לפי כיתה, מול ממוצע הכיתה"
            categories={classes.map((c) => c.name)}
            max={1}
            formatValue={(v) => grade(v)}
            series={[
              {
                label: STUDENT_LABEL,
                color: SERIES[0],
                values: classes.map((c) =>
                  c.average_score == null ? null : Number(c.average_score)
                ),
              },
              {
                label: CLASS_LABEL,
                color: SERIES[1],
                values: classes.map((c) =>
                  c.class_average_score == null
                    ? null
                    : Number(c.class_average_score)
                ),
              },
            ]}
          />
        </ChartCard>
      </ChartSlide>

      <ChartSlide>
        <ChartCard
          title="שיעור השלמה לפי כיתה"
          hint="כמה מהחידונים שהוקצו הושלמו"
          empty={classes.length === 0 ? "התלמיד/ה אינו/ה רשום/ה לכיתה." : undefined}
          table={{
            head: ["כיתה", "הושלמו", "שיעור"],
            rows: classes.map((c) => [
              c.name,
              `${c.quizzes_completed}/${c.total_assigned}`,
              pct(
                c.total_assigned > 0 ? c.quizzes_completed / c.total_assigned : null
              ),
            ]),
          }}
        >
          <ColumnChart
            ariaLabel="שיעור השלמה לפי כיתה"
            categories={classes.map((c) => c.name)}
            max={1}
            formatValue={(v) => pct(v)}
            series={[
              {
                label: "שיעור השלמה",
                color: SERIES[2],
                values: classes.map((c) =>
                  c.total_assigned > 0
                    ? c.quizzes_completed / c.total_assigned
                    : null
                ),
              },
            ]}
          />
        </ChartCard>
      </ChartSlide>

      <ChartSlide>
        <ChartCard
          title="שאלות ל-OrtAI לפי חידון"
          hint="איפה התלמיד/ה נעזר/ה במורה ה-AI"
          empty={
            withTutorQuestions.length === 0
              ? "התלמיד/ה עדיין לא שאל/ה את OrtAI."
              : undefined
          }
          table={{
            head: ["חידון", "שאלות"],
            rows: withTutorQuestions.map((q, i) => [
              shortTitle(q.title, i),
              q.tutor_question_count,
            ]),
          }}
        >
          <ColumnChart
            ariaLabel="שאלות ל-OrtAI לפי חידון"
            categories={withTutorQuestions.map((q, i) => shortTitle(q.title, i))}
            max={Math.max(1, ...withTutorQuestions.map((q) => q.tutor_question_count))}
            formatValue={(v) => String(Math.round(v))}
            series={[
              {
                label: "שאלות",
                color: SERIES[1],
                values: withTutorQuestions.map((q) => q.tutor_question_count),
              },
            ]}
          />
        </ChartCard>
      </ChartSlide>
    </ChartCarousel>
  );
}

"use client";

import { ChartCard } from "./ChartCard";
import { ColumnChart } from "./ColumnChart";
import { DonutChart } from "./DonutChart";
import { SCORE_BAND_COLORS, SERIES, grade, ltr, pct } from "./chartTheme";
import type { QuizAnalyticsOverview } from "@/lib/analytics";

/** "0–20" .. "80–100" for a score band, isolated as an LTR run (see `ltr`). */
function bandLabel(min: number, max: number): string {
  return ltr(`${Math.round(min * 100)}–${Math.round(max * 100)}`);
}

/** "1:23" from a question's playhead anchor. */
function timestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The quiz's charts, as a fixed 2×2 grid: how each class did with it, how the
 * grades are spread overall, and which questions students get wrong.
 *
 * The per-question chart is the one an author acts on. It plots correct-% in
 * question order rather than sorted by difficulty, because the order is what the
 * author edits against — the sorted "most often wrong" view is the table below,
 * where a rank is more use than a position.
 */
export function QuizCharts({ data }: { data: QuizAnalyticsOverview }) {
  const classes = data.classes;
  const distributionLabels = data.score_distribution.map((b) =>
    bandLabel(Number(b.bucket_min), Number(b.bucket_max))
  );
  const distributionCounts = data.score_distribution.map((b) => b.count);
  const distributionTotal = distributionCounts.reduce((sum, c) => sum + c, 0);
  const live = data.questions.filter((q) => !q.deleted);
  const answered = live.filter((q) => q.correct_pct != null);

  return (
    <div
      aria-label="תרשימי החידון"
      className="grid grid-cols-1 gap-4 lg:grid-cols-2"
    >
      <ChartCard
        title="אחוז מענה נכון לפי שאלה"
        hint="לפי סדר השאלות בחידון; אחוז נמוך = שאלה שמפילה"
        empty={
          answered.length === 0
            ? "עדיין אין תשובות לשאלות החידון."
            : undefined
        }
        table={{
          head: ["שאלה", "מיקום", "נכונות", "תשובות"],
          rows: live.map((q, i) => [
            `ש${i + 1}`,
            timestamp(q.position_seconds),
            pct(q.correct_pct),
            q.answered_count,
          ]),
        }}
      >
        <ColumnChart
          ariaLabel="אחוז מענה נכון לפי שאלה"
          categories={live.map((_, i) => `ש${i + 1}`)}
          max={1}
          formatValue={(v) => pct(v)}
          showCategoryLabels={false}
          series={[
            {
              label: "נכונות",
              color: SERIES[0],
              values: live.map((q) =>
                q.correct_pct == null ? null : Number(q.correct_pct)
              ),
            },
          ]}
        />
      </ChartCard>

      <ChartCard
        title="התפלגות הציונים"
        hint="כל התוצאות בכל הכיתות שהחידון רץ בהן"
        empty={
          distributionTotal === 0
            ? "עדיין אין תוצאות מוגמרות בחידון."
            : undefined
        }
        legend={distributionLabels.map((label, i) => ({
          label,
          color: SCORE_BAND_COLORS[i],
        }))}
        table={{
          head: ["טווח ציונים", "תוצאות", "אחוז"],
          rows: distributionLabels.map((label, i) => [
            label,
            distributionCounts[i],
            pct(distributionTotal > 0 ? distributionCounts[i] / distributionTotal : null),
          ]),
        }}
      >
        <DonutChart
          ariaLabel="התפלגות הציונים בחידון"
          slices={distributionLabels.map((label, i) => ({
            label,
            value: distributionCounts[i],
            color: SCORE_BAND_COLORS[i],
          }))}
          centerLabel={String(distributionTotal)}
          centerSub="תוצאות"
          formatValue={(v) =>
            `${Math.round(v)} (${pct(v / distributionTotal)})`
          }
        />
      </ChartCard>

      <ChartCard
        title="ציון ממוצע לפי כיתה"
        hint="ממוצע הציון האחרון של כל תלמיד/ה, מתוך 100"
        empty={classes.length === 0 ? "החידון עדיין לא הוקצה לכיתה." : undefined}
        table={{
          head: ["כיתה", "ציון ממוצע", "סיימו"],
          rows: classes.map((c) => [
            c.name,
            grade(c.average_score),
            `${c.students_completed}/${c.member_count}`,
          ]),
        }}
      >
        <ColumnChart
          ariaLabel="ציון ממוצע לפי כיתה"
          categories={classes.map((c) => c.name)}
          max={1}
          formatValue={(v) => grade(v)}
          showCategoryLabels={false}
          series={[
            {
              label: "ציון ממוצע",
              color: SERIES[0],
              values: classes.map((c) =>
                c.average_score == null ? null : Number(c.average_score)
              ),
            },
          ]}
        />
      </ChartCard>

      <ChartCard
        title="שיעור השלמה לפי כיתה"
        hint="חלק הכיתה שסיים את החידון"
        empty={classes.length === 0 ? "החידון עדיין לא הוקצה לכיתה." : undefined}
        table={{
          head: ["כיתה", "סיימו", "שיעור"],
          rows: classes.map((c) => [
            c.name,
            `${c.students_completed}/${c.member_count}`,
            pct(
              c.member_count > 0 ? c.students_completed / c.member_count : null
            ),
          ]),
        }}
      >
        <ColumnChart
          ariaLabel="שיעור השלמה לפי כיתה"
          categories={classes.map((c) => c.name)}
          max={1}
          formatValue={(v) => pct(v)}
          showCategoryLabels={false}
          series={[
            {
              label: "שיעור השלמה",
              color: SERIES[1],
              values: classes.map((c) =>
                c.member_count > 0 ? c.students_completed / c.member_count : null
              ),
            },
          ]}
        />
      </ChartCard>
    </div>
  );
}

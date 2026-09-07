"use client";

import { ChartCard } from "./ChartCard";
import { ColumnChart } from "./ColumnChart";
import { DonutChart } from "./DonutChart";
import {
  SCORE_BAND_COLORS,
  SERIES,
  grade,
  ltr,
  pct,
  withAlpha,
} from "./chartTheme";
import { allocationState } from "@/lib/allocationState";
import { STATE_LABEL } from "@/components/teacher/scheduleFormat";
import type { ClassAnalyticsOverview, ClassOverviewQuiz } from "@/lib/analytics";
import type { ClassRosterProgress } from "@/lib/analyticsProgress";

function byAssignedAt(a: ClassOverviewQuiz, b: ClassOverviewQuiz): number {
  return new Date(a.assigned_at).getTime() - new Date(b.assigned_at).getTime();
}

function bandLabel(min: number, max: number): string {
  return ltr(`${Math.round(min * 100)}–${Math.round(max * 100)}`);
}

function shortTitle(title: string | null, index: number): string {
  const name = title?.trim();
  if (!name) return `חידון ${index + 1}`;
  return name;
}

function hasActivity(quiz: ClassOverviewQuiz, attempts: number): boolean {
  return (
    attempts > 0 ||
    quiz.members_completed > 0 ||
    quiz.students_completed > 0 ||
    quiz.average_score != null
  );
}

function attemptsByQuiz(roster: ClassRosterProgress | null): Map<string, number> {
  const totals = new Map<string, number>();
  if (!roster) return totals;
  for (const member of roster.members) {
    for (const q of member.quizzes) {
      totals.set(q.quiz_id, (totals.get(q.quiz_id) ?? 0) + q.attempt_count);
    }
  }
  return totals;
}

export function ClassCharts({
  data,
  roster,
}: {
  data: ClassAnalyticsOverview;
  roster: ClassRosterProgress | null;
}) {
  const now = new Date();
  const attemptTotals = attemptsByQuiz(roster);
  // A quiz nobody has opened yet has nothing to plot in any of these charts, and
  // a run of empty columns is what makes the ones that do carry a number hard to
  // read. Filtered once for the whole grid rather than per chart, so a quiz keeps
  // the same position in every one of them and the four stay comparable.
  const quizzes = [...data.quizzes]
    .filter((q) => hasActivity(q, attemptTotals.get(q.quiz_id) ?? 0))
    .sort(byAssignedAt);
  const titles = quizzes.map((q, i) => shortTitle(q.title, i));
  const states = quizzes.map((q) => allocationState(q, now));
  const distributionLabels = data.score_distribution.map((b) =>
    bandLabel(Number(b.bucket_min), Number(b.bucket_max))
  );
  const distributionCounts = data.score_distribution.map((b) => b.count);
  const distributionTotal = distributionCounts.reduce((sum, c) => sum + c, 0);
  const anyScore = quizzes.some((q) => q.average_score != null);
  const attempts = quizzes.map((q) => attemptTotals.get(q.quiz_id) ?? 0);

  function emptyReason(): string | undefined {
    if (data.quizzes.length === 0) return "עדיין לא הוקצו חידונים.";
    if (quizzes.length === 0) return "עדיין לא התחילו חידונים בכיתה.";
    return undefined;
  }
  const maxAttempts = Math.max(1, ...attempts, ...quizzes.map((q) => q.member_count));

  function byState(base: string): string[] {
    return states.map((s) => (s === "live" ? withAlpha(base, 0.45) : base));
  }
  const stateLegend = (base: string) => [
    { label: STATE_LABEL.done, color: base },
    { label: STATE_LABEL.live, color: withAlpha(base, 0.45) },
  ];

  return (
    <div
      aria-label="תרשימי הכיתה"
      className="grid grid-cols-1 gap-4 lg:grid-cols-2"
    >
      <ChartCard
        title="ציון ממוצע לפי חידון"
        hint="ממוצע הכיתה, מתוך 100 — לפי סדר ההקצאה"
        empty={
          !anyScore ? "עדיין אין תוצאות מוגמרות בחידונים של הכיתה." : undefined
        }
        legend={stateLegend(SERIES[0])}
        table={{
          head: ["חידון", "מצב", "ציון ממוצע", "השלמות"],
          rows: quizzes.map((q, i) => [
            titles[i],
            STATE_LABEL[states[i]],
            grade(q.average_score),
            `${q.members_completed}/${q.member_count}`,
          ]),
        }}
      >
        <ColumnChart
          ariaLabel="ציון ממוצע לפי חידון"
          categories={titles}
          max={1}
          formatValue={(v) => grade(v)}
          showCategoryLabels={false}
          series={[
            {
              label: "ציון ממוצע",
              color: SERIES[0],
              colors: byState(SERIES[0]),
              values: quizzes.map((q) =>
                q.average_score == null ? null : Number(q.average_score)
              ),
            },
          ]}
        />
      </ChartCard>

      <ChartCard
        title="התפלגות הציונים בכיתה"
        hint="כמה תוצאות נפלו בכל טווח ציונים"
        empty={
          distributionTotal === 0
            ? "עדיין אין תוצאות מוגמרות בכיתה."
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
          ariaLabel="התפלגות הציונים בכיתה"
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
        title="שיעור השלמה לפי חידון"
        hint="חלק הכיתה שסיים כל חידון — לפי סדר ההקצאה"
        empty={emptyReason()}
        legend={stateLegend(SERIES[1])}
        table={{
          head: ["חידון", "מצב", "השלמות", "שיעור"],
          rows: quizzes.map((q, i) => [
            titles[i],
            STATE_LABEL[states[i]],
            `${q.members_completed}/${q.member_count}`,
            pct(q.member_count > 0 ? q.members_completed / q.member_count : null),
          ]),
        }}
      >
        <ColumnChart
          ariaLabel="שיעור השלמה לפי חידון"
          categories={titles}
          max={1}
          formatValue={(v) => pct(v)}
          showCategoryLabels={false}
          series={[
            {
              label: "שיעור השלמה",
              color: SERIES[1],
              colors: byState(SERIES[1]),
              values: quizzes.map((q) =>
                q.member_count > 0 ? q.members_completed / q.member_count : null
              ),
            },
          ]}
        />
      </ChartCard>

      <ChartCard
        title="השלמות מול ניסיונות לפי חידון"
        hint="פער גדול בין ניסיונות להשלמות מסגיר חידון קשה"
        empty={
          roster == null ? "לא ניתן לטעון את נתוני הניסיונות." : emptyReason()
        }
        legend={[
          { label: "השלמות", color: SERIES[0] },
          { label: "ניסיונות", color: SERIES[1] },
        ]}
        table={{
          head: ["חידון", "השלמות", "ניסיונות"],
          rows: quizzes.map((q, i) => [titles[i], q.members_completed, attempts[i]]),
        }}
      >
        <ColumnChart
          ariaLabel="השלמות מול ניסיונות לפי חידון"
          categories={titles}
          max={maxAttempts}
          formatValue={(v) => String(Math.round(v))}
          showCategoryLabels={false}
          series={[
            {
              label: "השלמות",
              color: SERIES[0],
              values: quizzes.map((q) => q.members_completed),
            },
            {
              label: "ניסיונות",
              color: SERIES[1],
              values: attempts,
            },
          ]}
        />
      </ChartCard>
    </div>
  );
}

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

/** Oldest-assigned first, so a reader can read the bars as the term unfolded. */
function byAssignedAt(a: ClassOverviewQuiz, b: ClassOverviewQuiz): number {
  return new Date(a.assigned_at).getTime() - new Date(b.assigned_at).getTime();
}

/** "0–20%" .. "80–100%" for a score band, isolated as an LTR run (see `ltr`). */
function bandLabel(min: number, max: number): string {
  return ltr(`${Math.round(min * 100)}–${Math.round(max * 100)}`);
}

/** Shorten a quiz title to something a category label can carry. */
function shortTitle(title: string | null, index: number): string {
  const name = title?.trim();
  if (!name) return `חידון ${index + 1}`;
  return name;
}

/**
 * Total attempts (completed or not) logged against each quiz by CURRENT
 * roster members, keyed by quiz id. Summed from the same per-member,
 * per-quiz breakdown `RosterTable` already reads — no separate fetch.
 */
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

/**
 * The class's charts, as a fixed 2×2 grid: how the class scored per quiz, how
 * the grades are spread, how much of the class finished each quiz, and how
 * many attempts it actually took to get there.
 *
 * Every chart here reads the same `class_analytics_overview` payload the tables
 * below read, and every score in it comes from each student's latest completed
 * attempt — so a number in a chart and the same number in a table can never
 * disagree.
 */
export function ClassCharts({
  data,
  roster,
}: {
  data: ClassAnalyticsOverview;
  /** For the attempts-vs-completions chart; that chart's empty when `null`. */
  roster: ClassRosterProgress | null;
}) {
  const now = new Date();
  const quizzes = [...data.quizzes].sort(byAssignedAt);
  const titles = quizzes.map((q, i) => shortTitle(q.title, i));
  const states = quizzes.map((q) => allocationState(q, now));
  const distributionLabels = data.score_distribution.map((b) =>
    bandLabel(Number(b.bucket_min), Number(b.bucket_max))
  );
  const distributionCounts = data.score_distribution.map((b) => b.count);
  const distributionTotal = distributionCounts.reduce((sum, c) => sum + c, 0);
  const anyScore = quizzes.some((q) => q.average_score != null);
  const attemptTotals = attemptsByQuiz(roster);
  const attempts = quizzes.map((q) => attemptTotals.get(q.quiz_id) ?? 0);
  const maxAttempts = Math.max(1, ...attempts, ...quizzes.map((q) => q.member_count));

  /** Solid once a quiz is done (the number is final); faded while it's still
   *  live (more completions could still land and move it). */
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
        empty={quizzes.length === 0 ? "עדיין לא הוקצו חידונים." : undefined}
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
          roster == null
            ? "לא ניתן לטעון את נתוני הניסיונות."
            : quizzes.length === 0
              ? "עדיין לא הוקצו חידונים."
              : undefined
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

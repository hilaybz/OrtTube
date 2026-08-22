"use client";

import { ChartCarousel, ChartSlide } from "./ChartCarousel";
import { ChartCard } from "./ChartCard";
import { ColumnChart } from "./ColumnChart";
import { LineChart } from "./LineChart";
import { ORDINAL_RAMP, SERIES, grade, pct } from "./chartTheme";
import type { ClassAnalyticsOverview } from "@/lib/analytics";

/** Widest day span drawn day-by-day; past it the series is aggregated by week. */
const MAX_DAILY_POINTS = 32;

const DAY_LABEL: Intl.DateTimeFormatOptions = { day: "numeric", month: "numeric" };

/** "0–20%" .. "80–100%" for a score band. */
function bandLabel(min: number, max: number): string {
  return `${Math.round(min * 100)}–${Math.round(max * 100)}`;
}

/**
 * Turn the sparse "days that had completions" list into a dense series the eye
 * can read as time. Empty days matter here — a flat stretch IS the finding — so
 * the gaps are filled with zeros rather than skipped, which would silently
 * compress a quiet fortnight into one step. Beyond a month the series is
 * aggregated into weeks so the axis stays legible instead of turning into a
 * picket fence.
 */
function completionSeries(
  completions: { day: string; count: number }[]
): { labels: string[]; values: number[]; weekly: boolean } {
  if (completions.length === 0) return { labels: [], values: [], weekly: false };

  const byDay = new Map(completions.map((c) => [c.day, c.count]));
  const days = completions.map((c) => new Date(`${c.day}T00:00:00Z`).getTime());
  const first = Math.min(...days);
  const last = Math.max(...days);
  const DAY_MS = 86_400_000;
  const span = Math.round((last - first) / DAY_MS) + 1;

  const dense: { date: Date; count: number }[] = [];
  for (let i = 0; i < span; i++) {
    const date = new Date(first + i * DAY_MS);
    dense.push({
      date,
      count: byDay.get(date.toISOString().slice(0, 10)) ?? 0,
    });
  }

  if (dense.length <= MAX_DAILY_POINTS) {
    return {
      labels: dense.map((d) => d.date.toLocaleDateString("he-IL", DAY_LABEL)),
      values: dense.map((d) => d.count),
      weekly: false,
    };
  }

  const weeks: { date: Date; count: number }[] = [];
  for (let i = 0; i < dense.length; i += 7) {
    const chunk = dense.slice(i, i + 7);
    weeks.push({
      date: chunk[0].date,
      count: chunk.reduce((sum, d) => sum + d.count, 0),
    });
  }
  return {
    labels: weeks.map((w) => w.date.toLocaleDateString("he-IL", DAY_LABEL)),
    values: weeks.map((w) => w.count),
    weekly: true,
  };
}

/** Shorten a quiz title to something a category label can carry. */
function shortTitle(title: string | null, index: number): string {
  const name = title?.trim();
  if (!name) return `חידון ${index + 1}`;
  return name;
}

/**
 * The class's charts, in a carousel: how the class scored per quiz, how the
 * grades are spread, how much of the class finished each quiz, and when the work
 * actually happened.
 *
 * Every chart here reads the same `class_analytics_overview` payload the tables
 * below read, and every score in it comes from each student's latest completed
 * attempt — so a number in a chart and the same number in a table can never
 * disagree.
 */
export function ClassCharts({ data }: { data: ClassAnalyticsOverview }) {
  const quizzes = data.quizzes;
  const titles = quizzes.map((q, i) => shortTitle(q.title, i));
  const distributionLabels = data.score_distribution.map((b) =>
    bandLabel(Number(b.bucket_min), Number(b.bucket_max))
  );
  const distributionCounts = data.score_distribution.map((b) => b.count);
  const maxBand = Math.max(1, ...distributionCounts);
  const completion = completionSeries(data.completions);
  const maxCompletions = Math.max(1, ...completion.values);
  const anyScore = quizzes.some((q) => q.average_score != null);

  return (
    <ChartCarousel label="תרשימי הכיתה">
      <ChartSlide>
        <ChartCard
          title="ציון ממוצע לפי חידון"
          hint="ממוצע הציון האחרון של כל תלמיד/ה, מתוך 100"
          empty={
            !anyScore ? "עדיין אין תוצאות מוגמרות בחידונים של הכיתה." : undefined
          }
          table={{
            head: ["חידון", "ציון ממוצע", "השלמות"],
            rows: quizzes.map((q, i) => [
              titles[i],
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
            series={[
              {
                label: "ציון ממוצע",
                color: SERIES[0],
                values: quizzes.map((q) =>
                  q.average_score == null ? null : Number(q.average_score)
                ),
              },
            ]}
          />
        </ChartCard>
      </ChartSlide>

      <ChartSlide>
        <ChartCard
          title="התפלגות הציונים בכיתה"
          hint="כמה תוצאות נפלו בכל טווח ציונים"
          empty={
            distributionCounts.every((c) => c === 0)
              ? "עדיין אין תוצאות מוגמרות בכיתה."
              : undefined
          }
          table={{
            head: ["טווח ציונים", "תוצאות"],
            rows: distributionLabels.map((label, i) => [
              label,
              distributionCounts[i],
            ]),
          }}
        >
          <ColumnChart
            ariaLabel="התפלגות הציונים בכיתה"
            categories={distributionLabels}
            max={maxBand}
            formatValue={(v) => String(Math.round(v))}
            series={[
              {
                label: "תוצאות",
                color: ORDINAL_RAMP[2],
                colors: ORDINAL_RAMP,
                values: distributionCounts,
              },
            ]}
          />
        </ChartCard>
      </ChartSlide>

      <ChartSlide>
        <ChartCard
          title="שיעור השלמה לפי חידון"
          hint="חלק הכיתה שסיים כל חידון"
          empty={quizzes.length === 0 ? "עדיין לא הוקצו חידונים." : undefined}
          table={{
            head: ["חידון", "השלמות", "שיעור"],
            rows: quizzes.map((q, i) => [
              titles[i],
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
            series={[
              {
                label: "שיעור השלמה",
                color: SERIES[1],
                values: quizzes.map((q) =>
                  q.member_count > 0 ? q.members_completed / q.member_count : null
                ),
              },
            ]}
          />
        </ChartCard>
      </ChartSlide>

      <ChartSlide>
        <ChartCard
          title={completion.weekly ? "השלמות לפי שבוע" : "השלמות לפי יום"}
          hint="מתי התלמידים באמת סיימו חידונים"
          empty={
            completion.values.length === 0
              ? "עדיין לא הושלמו חידונים בכיתה."
              : undefined
          }
          table={{
            head: [completion.weekly ? "שבוע" : "יום", "השלמות"],
            rows: completion.labels.map((label, i) => [
              label,
              completion.values[i],
            ]),
          }}
        >
          <LineChart
            ariaLabel={completion.weekly ? "השלמות לפי שבוע" : "השלמות לפי יום"}
            categories={completion.labels}
            max={maxCompletions}
            formatValue={(v) => String(Math.round(v))}
            series={[
              {
                label: "השלמות",
                color: SERIES[0],
                values: completion.values,
              },
            ]}
          />
        </ChartCard>
      </ChartSlide>
    </ChartCarousel>
  );
}

"use client";

import { ChartCard } from "./ChartCard";
import { ColumnChart } from "./ColumnChart";
import { ORDINAL_RAMP, SERIES, pct } from "./chartTheme";
import type { ClassQuizAnalytics } from "@/lib/analytics";

function bandLabel(min: number, max: number): string {
  return `${Math.round(min * 100)}–${Math.round(max * 100)}`;
}

function timestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Charts live in a client component because their formatters are functions, and
 * a function cannot cross the server/client boundary as a prop.
 */
export function ClassQuizCharts({ data }: { data: ClassQuizAnalytics }) {
  const distributionLabels = data.score_distribution.map((b) =>
    bandLabel(Number(b.bucket_min), Number(b.bucket_max))
  );
  const distributionCounts = data.score_distribution.map((b) => b.count);
  const live = data.questions.filter((q) => !q.deleted);

  return (
    <div
      aria-label="תרשימי החידון בכיתה"
      className="grid grid-cols-1 gap-4 lg:grid-cols-2"
    >
      <ChartCard
        title="התפלגות הציונים בכיתה"
        hint="כמה תלמידים נפלו בכל טווח ציונים"
        empty={
          data.students_completed === 0
            ? "עדיין אין תלמידים שסיימו את החידון."
            : undefined
        }
        table={{
          head: ["טווח ציונים", "תלמידים"],
          rows: distributionLabels.map((label, i) => [
            label,
            distributionCounts[i],
          ]),
        }}
      >
        <ColumnChart
          ariaLabel="התפלגות הציונים בכיתה"
          categories={distributionLabels}
          max={Math.max(1, ...distributionCounts)}
          formatValue={(v) => String(Math.round(v))}
          series={[
            {
              label: "תלמידים",
              color: ORDINAL_RAMP[2],
              colors: ORDINAL_RAMP,
              values: distributionCounts,
            },
          ]}
        />
      </ChartCard>

      <ChartCard
        title="אחוז מענה נכון לפי שאלה"
        hint="לפי סדר השאלות בחידון"
        empty={
          live.every((q) => q.correct_pct == null)
            ? "עדיין אין תשובות לשאלות החידון בכיתה."
            : undefined
        }
        table={{
          head: ["שאלה", "מיקום", "נכונות", "ענו"],
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
    </div>
  );
}

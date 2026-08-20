"use client";

import { useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/components/ui/cn";

/** One entry in a chart's legend — a colour swatch plus the entity it names. */
export interface LegendEntry {
  label: string;
  color: string;
  /** `line` mirrors a line mark, `rect` a column or area. */
  shape?: "line" | "rect";
}

/** The chart's table twin: the same numbers, reachable without hovering. */
export interface ChartTableData {
  head: string[];
  rows: (string | number)[][];
}

/**
 * The frame every analytics chart sits in: a glass card with a title, an
 * optional hint, a legend, and a toggle to the chart's TABLE TWIN.
 *
 * The table is not a nicety. Three of this product's series colours sit on a
 * translucent surface, and a chart that encodes a value only as a colour or a
 * bar length gates that value behind eyesight and a pointer. The toggle makes
 * every number readable as text, which is also what keeps the tooltip honestly
 * optional rather than the only way in.
 *
 * A legend renders only for two or more series: with one series the title
 * already names what is plotted, and a lone swatch would just restate it.
 */
export function ChartCard({
  title,
  hint,
  legend,
  table,
  empty,
  className,
  children,
}: {
  title: string;
  hint?: string;
  legend?: LegendEntry[];
  table?: ChartTableData;
  /** When set, the card shows this message instead of the chart. */
  empty?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const showLegend = !!legend && legend.length > 1;

  return (
    <GlassCard className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[var(--heading)]">{title}</h3>
          {hint && (
            <p className="mt-0.5 text-xs text-[var(--body-subtle)]">{hint}</p>
          )}
        </div>
        {table && !empty && (
          <IconButton
            name={showTable ? "chart" : "list"}
            label={showTable ? "הצגה כתרשים" : "הצגה כטבלה"}
            size="sm"
            tooltipPlacement="bottom"
            aria-pressed={showTable}
            onClick={() => setShowTable((v) => !v)}
          />
        )}
      </div>

      {showLegend && (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {legend.map((entry) => (
            <li
              key={entry.label}
              className="flex items-center gap-1.5 text-xs text-[var(--body)]"
            >
              <span
                aria-hidden="true"
                className="flex-none rounded-full"
                style={
                  entry.shape === "line"
                    ? { background: entry.color, width: 14, height: 2 }
                    : { background: entry.color, width: 10, height: 10 }
                }
              />
              {entry.label}
            </li>
          ))}
        </ul>
      )}

      {empty ? (
        <p className="py-8 text-center text-sm text-[var(--body-subtle)]">{empty}</p>
      ) : showTable && table ? (
        <ChartTable data={table} caption={title} />
      ) : (
        children
      )}
    </GlassCard>
  );
}

const HEAD = "px-3 py-2 text-start text-xs font-medium text-[var(--body)]";
const CELL = "px-3 py-2 text-start text-sm tabular-nums text-[var(--heading)]";

/** A chart's numbers as a plain table — the WCAG-clean twin of every chart. */
export function ChartTable({
  data,
  caption,
}: {
  data: ChartTableData;
  caption: string;
}) {
  return (
    <div className="max-h-[240px] overflow-auto">
      <table className="w-full border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[var(--glass-border-subtle)]">
            {data.head.map((h) => (
              <th key={h} scope="col" className={HEAD}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr
              key={i}
              className={
                i === data.rows.length - 1
                  ? undefined
                  : "border-b border-[var(--glass-border-subtle)]"
              }
            >
              {row.map((cell, j) => (
                <td key={j} className={CELL}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import { useState } from "react";
import { ChartTooltip } from "./ColumnChart";
import {
  BASELINE,
  BOX,
  CHROME,
  MARKS,
  PLOT_X0,
  PLOT_W,
  PLOT_Y0,
  ticksFor,
  xForIndex,
  yForValue,
} from "./chartTheme";

/** One line series. `values` is index-aligned with `categories`; `null` = a gap. */
export interface LineSeries {
  label: string;
  color: string;
  values: (number | null)[];
}

/**
 * One or two lines over a right-to-left axis (see `chartTheme`) — a trend, or a
 * trend against the thing it should be compared to.
 *
 * A crosshair finds the position rather than the line: the reader aims at a quiz
 * or a date, and one tooltip lists every series there, so the pointer never has
 * to land on a 2px stroke. Each position is also a `tabIndex` stop with the same
 * readout as an `aria-label`.
 *
 * Markers carry a ring in the surface colour, which is what keeps two series
 * legible where they cross. Gaps (`null`) break the path instead of being drawn
 * through as if the value were known.
 */
export function LineChart({
  categories,
  series,
  max = 1,
  formatValue,
  formatTick,
  ariaLabel,
}: {
  categories: string[];
  series: LineSeries[];
  max?: number;
  formatValue: (value: number) => string;
  formatTick?: (value: number) => string;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const n = categories.length;
  const tick = formatTick ?? formatValue;
  const band = PLOT_W / Math.max(n, 1);
  // With many positions, label only a handful of them so ticks never collide.
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(PLOT_W / 62))));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        width="100%"
        role="img"
        aria-label={ariaLabel}
        className="block h-auto w-full overflow-visible"
      >
        {ticksFor(max).map((value) => {
          const y = yForValue(value, max);
          return (
            <g key={value}>
              <line
                x1={PLOT_X0}
                x2={PLOT_X0 + PLOT_W}
                y1={y}
                y2={y}
                stroke={value === 0 ? CHROME.axis : CHROME.grid}
                strokeWidth={1}
              />
              <text
                x={PLOT_X0 + PLOT_W + 8}
                y={y + 4}
                textAnchor="start"
                direction="ltr"
                fontSize={11}
                fill={CHROME.muted}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {tick(value)}
              </text>
            </g>
          );
        })}

        {/* Crosshair for the focused position. */}
        {active != null && (
          <line
            x1={xForIndex(active, n)}
            x2={xForIndex(active, n)}
            y1={PLOT_Y0}
            y2={BASELINE}
            stroke={CHROME.axis}
            strokeWidth={1}
          />
        )}

        {series.map((s) => (
          <g key={s.label}>
            {segmentsOf(s.values, n).map((segment, si) => (
              <polyline
                key={si}
                points={segment
                  .map(({ i, value }) => `${xForIndex(i, n)},${yForValue(value, max)}`)
                  .join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={MARKS.lineWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {s.values.map((value, i) =>
              value == null ? null : (
                <circle
                  key={i}
                  cx={xForIndex(i, n)}
                  cy={yForValue(value, max)}
                  r={active === i ? MARKS.markerRadius + 1 : MARKS.markerRadius}
                  fill={s.color}
                  stroke={CHROME.surface}
                  strokeWidth={MARKS.markerRing}
                />
              )
            )}
          </g>
        ))}

        {categories.map((category, i) => {
          const cx = xForIndex(i, n);
          const readout = series
            .map((s) => {
              const v = s.values[i];
              return `${s.label}: ${v == null ? "—" : formatValue(v)}`;
            })
            .join(", ");
          return (
            <g key={`${category}-${i}`}>
              <rect
                x={cx - band / 2}
                y={PLOT_Y0}
                width={band}
                height={BASELINE - PLOT_Y0}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={`${category} — ${readout}`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="cursor-default outline-none focus-visible:stroke-[var(--brand)] focus-visible:[stroke-width:2]"
              />
              {(i % labelEvery === 0 || active === i) && (
                <text
                  x={cx}
                  y={BASELINE + 16}
                  textAnchor="middle"
                  fontSize={11}
                  fill={active === i ? CHROME.ink : CHROME.muted}
                  pointerEvents="none"
                >
                  {category}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {active != null && (
        <ChartTooltip
          x={xForIndex(active, n)}
          title={categories[active]}
          rows={series.map((s) => ({
            label: s.label,
            color: s.color,
            value:
              s.values[active] == null
                ? "—"
                : formatValue(s.values[active] as number),
          }))}
        />
      )}
    </div>
  );
}

/**
 * Split a series into the runs of consecutive known values. A `null` is a gap in
 * the data, so the path breaks there rather than interpolating across it; a run
 * of one point still yields a segment so its marker is drawn.
 */
function segmentsOf(
  values: (number | null)[],
  count: number
): { i: number; value: number }[][] {
  const segments: { i: number; value: number }[][] = [];
  let current: { i: number; value: number }[] = [];
  for (let i = 0; i < count; i++) {
    const value = values[i];
    if (value == null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push({ i, value });
    }
  }
  if (current.length) segments.push(current);
  return segments.filter((s) => s.length > 1);
}

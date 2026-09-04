"use client";

import { useState } from "react";
import { ChartTooltip } from "./ColumnChart";
import { BOX, CHROME } from "./chartTheme";

/** One ring segment. `values` outside 0 are ignored (an empty band draws nothing). */
export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

const SIZE = 200;
const CENTER = SIZE / 2;
const OUTER_R = 90;
const INNER_R = 56;
const GAP_DEG = 1.5;

function polar(angleDeg: number, r: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CENTER + r * Math.cos(rad), y: CENTER + r * Math.sin(rad) };
}

/** SVG path for one ring segment between two angles (0° = top, clockwise). */
function ringPath(startDeg: number, endDeg: number): string {
  const outerStart = polar(startDeg, OUTER_R);
  const outerEnd = polar(endDeg, OUTER_R);
  const innerEnd = polar(endDeg, INNER_R);
  const innerStart = polar(startDeg, INNER_R);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${INNER_R} ${INNER_R} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

/**
 * A ring chart for a total split across ordered bands — one series, drawn as
 * segments rather than columns because the whole (the center label) matters as
 * much as the parts here.
 *
 * Each segment gets a hairline gap rather than a stroke, matching how
 * `ColumnChart` separates adjacent columns with the surface showing through.
 * The same hover/focus tooltip as the linear charts (`ChartTooltip`) reads out
 * the active segment, so a value is never gated behind eyesight alone.
 */
export function DonutChart({
  slices,
  centerLabel,
  centerSub,
  formatValue,
  ariaLabel,
}: {
  slices: DonutSlice[];
  /** Big number in the ring's center, e.g. the total count. */
  centerLabel?: string;
  /** Small caption under the center label. */
  centerSub?: string;
  formatValue: (value: number) => string;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const spans = slices.map((s) => (total > 0 ? (s.value / total) * 360 : 0));

  const segments = slices.map((slice, i) => {
    const cursor = spans.slice(0, i).reduce((sum, span) => sum + span, 0);
    const span = spans[i];
    const start = cursor + (span > 0 ? GAP_DEG / 2 : 0);
    const end = cursor + span - (span > 0 ? GAP_DEG / 2 : 0);
    return { ...slice, index: i, start: Math.min(start, end), end: Math.max(start, end) };
  });

  return (
    <div className="relative flex items-center justify-center">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label={ariaLabel}
        className="block overflow-visible"
      >
        {segments.map((s) =>
          s.value <= 0 ? null : (
            <path
              key={s.label}
              d={ringPath(s.start, s.end)}
              fill={s.color}
              opacity={active == null || active === s.index ? 1 : 0.55}
              tabIndex={0}
              role="img"
              aria-label={`${s.label} — ${formatValue(s.value)}`}
              onPointerEnter={() => setActive(s.index)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(s.index)}
              onBlur={() => setActive(null)}
              className="cursor-default outline-none focus-visible:stroke-[var(--brand)] focus-visible:[stroke-width:2]"
            />
          )
        )}
        {centerLabel && (
          <text
            x={CENTER}
            y={centerSub ? CENTER - 4 : CENTER + 6}
            textAnchor="middle"
            fontSize={28}
            fontWeight={700}
            fill={CHROME.ink}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {centerLabel}
          </text>
        )}
        {centerSub && (
          <text
            x={CENTER}
            y={CENTER + 20}
            textAnchor="middle"
            fontSize={13}
            fill={CHROME.muted}
          >
            {centerSub}
          </text>
        )}
      </svg>

      {active != null && (
        <ChartTooltip
          x={
            (polar((segments[active].start + segments[active].end) / 2, OUTER_R)
              .x /
              SIZE) *
            BOX.width
          }
          title={segments[active].label}
          rows={[
            {
              label: segments[active].label,
              color: segments[active].color,
              value: formatValue(segments[active].value),
            },
          ]}
        />
      )}
    </div>
  );
}

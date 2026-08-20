"use client";

import { useState } from "react";
import {
  BASELINE,
  BOX,
  CHROME,
  MARKS,
  PLOT_X0,
  PLOT_W,
  PLOT_Y0,
  bandWidth,
  ticksFor,
  xForIndex,
  yForValue,
} from "./chartTheme";

/** One column series. `values` is index-aligned with `categories`. */
export interface ColumnSeries {
  label: string;
  color: string;
  /** `null` = no data for that category (the column is simply absent). */
  values: (number | null)[];
  /**
   * Per-category colours, for a single series over ORDERED categories (the score
   * bands) where an ordinal ramp is the right encoding. Never use this to make
   * nominal categories darker-where-bigger — that double-encodes bar length as
   * hue and burns the only free channel on information the bars already carry.
   */
  colors?: readonly string[];
}

/**
 * Columns over a right-to-left category axis (see `chartTheme`), for one or two
 * series.
 *
 * Reading aids, in the order the data-viz method prefers them: direct labels on
 * the caps when there is room, then the value axis, then the hover/focus
 * tooltip, then the card's table twin. Direct labels appear only for a single
 * series with few enough categories that they cannot collide — flooding every
 * cap with a number is how a chart stops being read.
 *
 * Each category owns one transparent hit band spanning the full plot height, so
 * the hover target is the whole column slot rather than the painted pixels of a
 * 3px-tall bar, and it is a `tabIndex` stop carrying the same readout as an
 * `aria-label` for keyboard and screen-reader users.
 *
 * Adjacent columns are separated by real space (the card surface showing
 * through), never by a stroke around the mark.
 */
export function ColumnChart({
  categories,
  series,
  max = 1,
  formatValue,
  formatTick,
  ariaLabel,
}: {
  categories: string[];
  series: ColumnSeries[];
  /** Top of the value axis. Defaults to 1 for 0..1 fractions. */
  max?: number;
  formatValue: (value: number) => string;
  /** Axis ticks; defaults to `formatValue`. */
  formatTick?: (value: number) => string;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const n = categories.length;
  const band = bandWidth(n);
  const tick = formatTick ?? formatValue;

  // Direct labels only where they provably fit: one series, and a band wide
  // enough for a two-or-three character value with padding.
  const directLabels = series.length === 1 && band >= 42;
  const groupWidth = Math.min(band * MARKS.bandFill, MARKS.maxColumnWidth * series.length + 2);
  const colWidth = Math.max(3, (groupWidth - 2 * (series.length - 1)) / series.length);
  const maxChars = Math.max(3, Math.floor(band / 6.4));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        width="100%"
        role="img"
        aria-label={ariaLabel}
        className="block h-auto w-full overflow-visible"
      >
        {/* Hairline value grid + its labels, at the inline start (right). */}
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

        {categories.map((category, i) => {
          const cx = xForIndex(i, n);
          const isActive = active === i;
          const readout = series
            .map((s) => {
              const v = s.values[i];
              return `${s.label}: ${v == null ? "—" : formatValue(v)}`;
            })
            .join(", ");

          return (
            <g key={`${category}-${i}`}>
              {/* Hit band: the whole slot, so a short column is still easy to reach. */}
              <rect
                x={cx - band / 2}
                y={PLOT_Y0}
                width={band}
                height={BASELINE - PLOT_Y0}
                fill={isActive ? "rgba(15,23,42,0.035)" : "transparent"}
                tabIndex={0}
                role="img"
                aria-label={`${category} — ${readout}`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="cursor-default outline-none focus-visible:stroke-[var(--brand)] focus-visible:[stroke-width:2]"
              />

              {series.map((s, si) => {
                const value = s.values[i];
                if (value == null) return null;
                const y = yForValue(value, max);
                const height = Math.max(BASELINE - y, 2);
                const x =
                  cx -
                  groupWidth / 2 +
                  si * (colWidth + 2);
                return (
                  <rect
                    key={s.label}
                    x={x}
                    y={y}
                    width={colWidth}
                    height={height}
                    rx={MARKS.columnRadius}
                    fill={s.colors?.[i] ?? s.color}
                    opacity={active == null || isActive ? 1 : 0.55}
                    pointerEvents="none"
                  />
                );
              })}

              {/* Square off the rounded bottom so columns sit ON the baseline. */}
              {series.map((s, si) => {
                const value = s.values[i];
                if (value == null) return null;
                const x = cx - groupWidth / 2 + si * (colWidth + 2);
                return (
                  <rect
                    key={`${s.label}-foot`}
                    x={x}
                    y={BASELINE - MARKS.columnRadius}
                    width={colWidth}
                    height={MARKS.columnRadius}
                    fill={s.colors?.[i] ?? s.color}
                    opacity={active == null || isActive ? 1 : 0.55}
                    pointerEvents="none"
                  />
                );
              })}

              {directLabels && series[0].values[i] != null && (
                <text
                  x={cx}
                  y={yForValue(series[0].values[i] as number, max) - 6}
                  textAnchor="middle"
                  direction="ltr"
                  fontSize={11}
                  fontWeight={600}
                  fill={CHROME.ink}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                  pointerEvents="none"
                >
                  {formatValue(series[0].values[i] as number)}
                </text>
              )}

              <text
                x={cx}
                y={BASELINE + 16}
                textAnchor="middle"
                fontSize={11}
                fill={isActive ? CHROME.ink : CHROME.muted}
                pointerEvents="none"
              >
                {category.length > maxChars
                  ? `${category.slice(0, maxChars - 1)}…`
                  : category}
              </text>
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
            color: s.colors?.[active] ?? s.color,
            value: s.values[active] == null ? "—" : formatValue(s.values[active] as number),
          }))}
        />
      )}
    </div>
  );
}

/**
 * The shared hover/focus readout. Value leads, series name follows: the reader
 * already knows which series they are on and wants the number. Keyed by a short
 * stroke of the series colour rather than a filled box — at this density a box
 * is data-weight ink doing a label's job.
 *
 * Positioned as a percentage of the chart's viewBox so it tracks the mark
 * through any responsive scaling, and pinned inside the card's edges.
 */
export function ChartTooltip({
  x,
  title,
  rows,
}: {
  /** viewBox x of the mark the tooltip belongs to. */
  x: number;
  title: string;
  rows: { label: string; color: string; value: string }[];
}) {
  const left = (x / BOX.width) * 100;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-1 z-10 max-w-[220px] -translate-x-1/2 rounded-[var(--radius-d)] border border-[var(--glass-border)] bg-white/95 px-3 py-2 text-start shadow-[var(--shadow-xs)]"
      style={{ left: `${Math.min(Math.max(left, 16), 84)}%` }}
    >
      <p className="mb-1 truncate text-xs text-[var(--body-subtle)]">{title}</p>
      <ul className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2 whitespace-nowrap">
            <span
              className="flex-none rounded-full"
              style={{ background: row.color, width: 12, height: 2 }}
            />
            <span
              dir="ltr"
              className="text-sm font-semibold tabular-nums text-[var(--heading)]"
            >
              {row.value}
            </span>
            <span className="truncate text-xs text-[var(--body-subtle)]">
              {row.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

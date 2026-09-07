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

export interface ColumnSeries {
  label: string;
  color: string;
  values: (number | null)[];
  /**
   * Per-category colours, for a single series over ORDERED categories (the score
   * bands) where an ordinal ramp is the right encoding. Never use this to make
   * nominal categories darker-where-bigger — that double-encodes bar length as
   * hue and burns the only free channel on information the bars already carry.
   */
  colors?: readonly string[];
}

export function ColumnChart({
  categories,
  series,
  max = 1,
  formatValue,
  formatTick,
  ariaLabel,
  showCategoryLabels = true,
}: {
  categories: string[];
  series: ColumnSeries[];
  max?: number;
  formatValue: (value: number) => string;
  formatTick?: (value: number) => string;
  ariaLabel: string;
  /**
   * Set `false` to drop the printed label under each column, relying on the
   * hover/focus tooltip (and the table twin) to name a category instead. For
   * many categories at once, a name under every column is what forces them
   * narrow and truncated in the first place — dropping it lets the columns
   * use the freed space rather than fight over it. The hit band and its
   * `aria-label` are unaffected, so keyboard/screen-reader access doesn't
   * regress.
   */
  showCategoryLabels?: boolean;
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

              {/*
                A slot with no value still gets a mark — a bare gap with no
                category label under it (see `showCategoryLabels`) reads as a
                broken chart rather than "no data for this one", especially
                once there's nothing printed nearby to say which category it
                even is.
              */}
              {series.map((s, si) => {
                const value = s.values[i];
                if (value != null) return null;
                const x = cx - groupWidth / 2 + si * (colWidth + 2);
                return (
                  <rect
                    key={`${s.label}-empty`}
                    x={x}
                    y={BASELINE - 2}
                    width={colWidth}
                    height={2}
                    rx={1}
                    fill={CHROME.muted}
                    opacity={active == null || isActive ? 0.6 : 0.35}
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

              {showCategoryLabels && (
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
            color: s.colors?.[active] ?? s.color,
            value: s.values[active] == null ? "—" : formatValue(s.values[active] as number),
          }))}
        />
      )}
    </div>
  );
}

export function ChartTooltip({
  x,
  title,
  rows,
}: {
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

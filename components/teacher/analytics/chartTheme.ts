/**
 * **Three slots is the ceiling here, and it is deliberate.** A fourth hue cannot
 * clear the all-pairs gates on this surface, and none of these charts has a
 * fourth series to show: the comparisons are "this one vs. the class", never a
 * league table. Anything that would need a fourth series becomes a table or
 * small multiples instead of a generated hue.
 *
 * Slots are assigned by ENTITY, never by rank — the student is always slot 1 and
 * the class average always slot 2, so filtering or reordering never repaints
 * them.
 *
 * ## RTL
 *
 * Every chart here runs its category/time axis **right → left**, matching the
 * page. One rule for all of them on purpose: a carousel where the bars read
 * right-to-left and the trend line reads left-to-right would be worse than
 * either convention alone. `xForIndex` is the single place that decision lives.
 */

/** Categorical series slots, in fixed assignment order. Never cycle past slot 3. */
export const SERIES = ["#0b8f5d", "#2a78d6", "#4a3aa7"] as const;

export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const ORDINAL_RAMP = [
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
  "#0d366b",
] as const;

/**
 * A five-hue categorical palette for the same score bands, low → high, used
 * ONLY by the class-analytics grade-distribution donut
 * (`ClassCharts.tsx`) — a deliberate, explicitly-requested deviation from
 * `ORDINAL_RAMP` to match a supplied design reference. Unlike the rest of this
 * file's palette, this one has not been run through the contrast/CVD
 * validator; do not reuse it elsewhere without doing that pass.
 */
export const SCORE_BAND_COLORS = [
  "#df6b78",
  "#a98fe0",
  "#efc24e",
  "#57c39a",
  "#6c97f0",
] as const;

export const CHROME = {
  grid: "rgba(15, 23, 42, 0.08)",
  axis: "rgba(15, 23, 42, 0.16)",
  muted: "#64748b",
  ink: "#475569",
  surface: "#ffffff",
} as const;

export const MARKS = {
  maxColumnWidth: 24,
  bandFill: 0.62,
  columnRadius: 4,
  lineWidth: 2,
  markerRadius: 4,
  markerRing: 2,
} as const;

export const BOX = {
  width: 520,
  height: 260,
  padStart: 46,
  padEnd: 14,
  padTop: 18,
  padBottom: 40,
} as const;

export const PLOT_X0 = BOX.padEnd;
export const PLOT_W = BOX.width - BOX.padStart - BOX.padEnd;
export const PLOT_Y0 = BOX.padTop;
export const PLOT_H = BOX.height - BOX.padTop - BOX.padBottom;
export const BASELINE = PLOT_Y0 + PLOT_H;

/**
 * Centre x of category `i` of `count`, laid out right → left. The one place the
 * RTL axis direction is decided; every chart body calls it.
 */
export function xForIndex(i: number, count: number): number {
  const band = PLOT_W / Math.max(count, 1);
  return PLOT_X0 + PLOT_W - (i + 0.5) * band;
}

export function bandWidth(count: number): number {
  return PLOT_W / Math.max(count, 1);
}

export function yForValue(value: number, max: number): number {
  const safeMax = max > 0 ? max : 1;
  const t = Math.min(Math.max(value / safeMax, 0), 1);
  return BASELINE - t * PLOT_H;
}

export function pct(fraction: number | null | undefined): string {
  return fraction == null ? "—" : `${Math.round(fraction * 100)}%`;
}

/**
 * Isolate a numeral-only string (a range like "80–100", a "range: count" pair)
 * as its own left-to-right run, via Unicode bidi isolates rather than markup.
 * Needed anywhere such a string can land inside RTL text or an RTL table cell
 * with no adjacent Hebrew character to anchor it — without an anchor, the
 * bidi algorithm has nothing to key its own base direction off of and can
 * reorder the digits themselves (`"80–100"` rendering as `"100-80"`), not just
 * the run's position.
 */
export function ltr(text: string): string {
  return `⁦${text}⁩`;
}

export function grade(fraction: number | null | undefined): string {
  return fraction == null ? "—" : String(Math.round(fraction * 100));
}

export function ticksFor(max: number): number[] {
  const safeMax = max > 0 ? max : 1;
  return [0, 0.25, 0.5, 0.75, 1].map((t) => t * safeMax);
}

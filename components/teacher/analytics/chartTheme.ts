/**
 * The parameters every analytics chart is drawn from: the series palette, the
 * chart chrome, and the two geometry rules that keep marks quiet.
 *
 * ## Colour
 *
 * The palette is not a taste call — it was validated with the data-viz
 * validator against THIS product's surface (a glass card, ≈ `#eff0f6` once the
 * translucent white settles over the app gradient), in the fixed slot order
 * below. On that surface, in that order, every adjacent pair clears the
 * colour-vision-deficiency separation gate and the normal-vision floor, and all
 * three slots clear 3:1 contrast:
 *
 *   1 `#0b8f5d` emerald — the brand hue, one step darker than `--brand` so it
 *      clears contrast on glass (`--brand` itself measures 2.76:1 there).
 *   2 `#2a78d6` blue
 *   3 `#4a3aa7` violet
 *
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
 * `ORDINAL_RAMP` is the separate one-hue blue ramp for the score bands, which
 * are ordered categories (0–20% … 80–100%) rather than identities. It was
 * validated as an ordinal ramp: monotone lightness, visible steps, and a light
 * end that still clears the surface.
 *
 * ## RTL
 *
 * Every chart here runs its category/time axis **right → left**, matching the
 * page. One rule for all of them on purpose: a carousel where the bars read
 * right-to-left and the trend line reads left-to-right would be worse than
 * either convention alone. `xForIndex` is the single place that decision lives.
 *
 * ## Marks
 *
 * Thin marks, hairline solid grid, and negative space doing the separating:
 * adjacent columns are separate rects with real space between them (the surface
 * shows through — never a stroke drawn around a mark), and line markers carry a
 * ring in the surface colour so they stay legible where they overlap.
 */

/** Categorical series slots, in fixed assignment order. Never cycle past slot 3. */
export const SERIES = ["#0b8f5d", "#2a78d6", "#4a3aa7"] as const;

/** One-hue ordinal ramp (light → dark) for the five ordered score bands. */
export const ORDINAL_RAMP = [
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
  "#0d366b",
] as const;

/** Chart chrome. Recessive by design: the data is the only loud thing. */
export const CHROME = {
  /** Hairline gridline, one step off the glass surface. */
  grid: "rgba(15, 23, 42, 0.08)",
  /** The axis rule itself, a touch stronger than a gridline. */
  axis: "rgba(15, 23, 42, 0.16)",
  /** Axis tick + category labels. */
  muted: "#64748b",
  /** Value labels riding the marks. */
  ink: "#475569",
  /** Ring around overlapping markers, and the gap colour where one is needed. */
  surface: "#ffffff",
} as const;

/** Mark geometry, fixed across every chart (see the data-viz mark specs). */
export const MARKS = {
  /** Columns never fill their band — the leftover is air. */
  maxColumnWidth: 24,
  /** Fraction of the band a column group may occupy. */
  bandFill: 0.62,
  /** Rounded data-end, square at the baseline. */
  columnRadius: 4,
  lineWidth: 2,
  markerRadius: 4,
  markerRing: 2,
} as const;

/** The drawing box every chart body shares, so a carousel of them lines up. */
export const BOX = {
  width: 520,
  height: 260,
  /** Inline-start (right, in RTL) — the value axis and its labels live here. */
  padStart: 46,
  /** Inline-end (left) — room for the last category label to breathe. */
  padEnd: 14,
  padTop: 18,
  /** Room for the category band under the plot, so no axis label is clipped. */
  padBottom: 40,
} as const;

export const PLOT_X0 = BOX.padEnd;
export const PLOT_W = BOX.width - BOX.padStart - BOX.padEnd;
export const PLOT_Y0 = BOX.padTop;
export const PLOT_H = BOX.height - BOX.padTop - BOX.padBottom;
/** Baseline y — where every column starts and the category axis is drawn. */
export const BASELINE = PLOT_Y0 + PLOT_H;

/**
 * Centre x of category `i` of `count`, laid out right → left. The one place the
 * RTL axis direction is decided; every chart body calls it.
 */
export function xForIndex(i: number, count: number): number {
  const band = PLOT_W / Math.max(count, 1);
  return PLOT_X0 + PLOT_W - (i + 0.5) * band;
}

/** Width of one category band. */
export function bandWidth(count: number): number {
  return PLOT_W / Math.max(count, 1);
}

/** y for a value on a 0..`max` scale, clamped so a stray value can't escape the plot. */
export function yForValue(value: number, max: number): number {
  const safeMax = max > 0 ? max : 1;
  const t = Math.min(Math.max(value / safeMax, 0), 1);
  return BASELINE - t * PLOT_H;
}

/** Render a 0..1 fraction as a whole-percent string, or an em dash when null. */
export function pct(fraction: number | null | undefined): string {
  return fraction == null ? "—" : `${Math.round(fraction * 100)}%`;
}

/**
 * A 0..1 fraction as a grade out of 100 — how the product speaks about scores
 * to teachers and students alike. `null` becomes an em dash.
 */
export function grade(fraction: number | null | undefined): string {
  return fraction == null ? "—" : String(Math.round(fraction * 100));
}

/** Four "nice" gridline values for a 0..`max` axis, `max` included. */
export function ticksFor(max: number): number[] {
  const safeMax = max > 0 ? max : 1;
  return [0, 0.25, 0.5, 0.75, 1].map((t) => t * safeMax);
}

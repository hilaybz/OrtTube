/**
 * The chart geometry every analytics chart is drawn from.
 *
 * These are the two decisions a chart cannot get wrong without being actively
 * misleading, so they are pinned here rather than left to eyeballing a rendered
 * SVG: the axis runs RIGHT to LEFT (the app is RTL-only, and `xForIndex` is the
 * single place that direction lives — a chart that silently flipped would invert
 * every trend a teacher reads), and a value maps to a y coordinate that cannot
 * escape the plot.
 *
 * Pure math, no DOM, no database.
 */
import { describe, expect, it } from "vitest";
import {
  BASELINE,
  PLOT_H,
  PLOT_W,
  PLOT_X0,
  PLOT_Y0,
  bandWidth,
  grade,
  pct,
  ticksFor,
  xForIndex,
  yForValue,
} from "@/components/teacher/analytics/chartTheme";

describe("xForIndex (RTL category axis)", () => {
  it("puts the first category at the inline start — the RIGHT edge", () => {
    const first = xForIndex(0, 4);
    const last = xForIndex(3, 4);
    expect(first).toBeGreaterThan(last);
    // The first band's centre sits half a band in from the right edge.
    expect(first).toBeCloseTo(PLOT_X0 + PLOT_W - bandWidth(4) / 2, 6);
  });

  it("spaces categories evenly and keeps every one inside the plot", () => {
    const count = 7;
    const centres = Array.from({ length: count }, (_, i) => xForIndex(i, count));
    const gaps = centres.slice(1).map((x, i) => centres[i] - x);
    for (const gap of gaps) expect(gap).toBeCloseTo(bandWidth(count), 6);
    for (const x of centres) {
      expect(x).toBeGreaterThan(PLOT_X0);
      expect(x).toBeLessThan(PLOT_X0 + PLOT_W);
    }
  });

  it("centres a lone category in the plot", () => {
    expect(xForIndex(0, 1)).toBeCloseTo(PLOT_X0 + PLOT_W / 2, 6);
  });

  it("never divides by zero for an empty series", () => {
    expect(Number.isFinite(bandWidth(0))).toBe(true);
    expect(Number.isFinite(xForIndex(0, 0))).toBe(true);
  });
});

describe("yForValue", () => {
  it("puts zero on the baseline and the maximum at the top of the plot", () => {
    expect(yForValue(0, 1)).toBeCloseTo(BASELINE, 6);
    expect(yForValue(1, 1)).toBeCloseTo(PLOT_Y0, 6);
    expect(yForValue(0.5, 1)).toBeCloseTo(BASELINE - PLOT_H / 2, 6);
  });

  it("clamps a value outside the scale instead of drawing outside the plot", () => {
    expect(yForValue(-5, 1)).toBeCloseTo(BASELINE, 6);
    expect(yForValue(9, 1)).toBeCloseTo(PLOT_Y0, 6);
  });

  it("treats a zero or negative maximum as 1 rather than dividing by it", () => {
    expect(Number.isFinite(yForValue(1, 0))).toBe(true);
    expect(yForValue(0, 0)).toBeCloseTo(BASELINE, 6);
  });

  it("scales against a count axis, not only fractions", () => {
    expect(yForValue(4, 8)).toBeCloseTo(BASELINE - PLOT_H / 2, 6);
  });
});

describe("ticksFor", () => {
  it("returns five ticks from zero to the maximum", () => {
    expect(ticksFor(1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(ticksFor(8)).toEqual([0, 2, 4, 6, 8]);
  });
});

describe("value formatting", () => {
  it("renders a fraction as a grade out of 100, the way the product speaks", () => {
    expect(grade(0.756)).toBe("76");
    expect(grade(1)).toBe("100");
    expect(grade(0)).toBe("0");
  });

  it("renders a fraction as a percentage where a rate is meant", () => {
    expect(pct(0.5)).toBe("50%");
    expect(pct(0.004)).toBe("0%");
  });

  it("renders an unknown value as an em dash, never as zero", () => {
    expect(grade(null)).toBe("—");
    expect(grade(undefined)).toBe("—");
    expect(pct(null)).toBe("—");
  });
});

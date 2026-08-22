import { describe, it, expect } from "vitest";
import { canSeekTo, gateDecision } from "@/components/video/gate";

describe("gateDecision (Edpuzzle-style block-skip gate)", () => {
  it("no active checkpoint → never at gate, never clamps", () => {
    expect(gateDecision(120, null)).toEqual({ atGate: false, clampTo: null });
  });

  it("before the checkpoint → not reached, free to watch", () => {
    expect(gateDecision(10, 30)).toEqual({ atGate: false, clampTo: null });
  });

  it("exactly at the checkpoint → reached, no clamp", () => {
    expect(gateDecision(30, 30)).toEqual({ atGate: true, clampTo: null });
  });

  it("a hair past (within tolerance) → reached, no clamp", () => {
    expect(gateDecision(30.3, 30)).toEqual({ atGate: true, clampTo: null });
  });

  it("skipped well past → snaps back to the checkpoint and reveals", () => {
    expect(gateDecision(75, 30)).toEqual({ atGate: true, clampTo: 30 });
  });
});

describe("canSeekTo (the same rule, asked forwards)", () => {
  it("no active checkpoint → the whole video is open", () => {
    expect(canSeekTo(0, null)).toBe(true);
    expect(canSeekTo(9999, null)).toBe(true);
  });

  it("anything before the checkpoint is the student's to re-watch", () => {
    expect(canSeekTo(0, 30)).toBe(true);
    expect(canSeekTo(29, 30)).toBe(true);
  });

  it("the checkpoint itself is reachable — it is where the gate stands", () => {
    expect(canSeekTo(30, 30)).toBe(true);
  });

  it("past the checkpoint is exactly what the gate withholds", () => {
    expect(canSeekTo(31, 30)).toBe(false);
    expect(canSeekTo(600, 30)).toBe(false);
  });
});

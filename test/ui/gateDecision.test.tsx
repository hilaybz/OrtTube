import { describe, it, expect } from "vitest";
import { gateDecision } from "@/components/student/gate";

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

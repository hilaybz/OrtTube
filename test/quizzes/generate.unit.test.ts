/**
 * Generation unit tests — pure generation helpers (no DB, no network).
 *
 * Covers segment-boundary snapping and answer-key coercion so persistence never
 * trips the correctness invariant (spec §3.4).
 */
import { describe, it, expect } from "vitest";
import {
  snapToSegmentBoundary,
  normalizeGeneratedQuestion,
} from "@/lib/ai/generate";
import type { TranscriptSegment } from "@/lib/transcript";

// A three-segment transcript whose spoken parts start at 0s, 10s and 30s
// (offsets are in milliseconds).
const transcriptSegments: TranscriptSegment[] = [
  { text: "a", offset: 0, duration: 5000 },
  { text: "b", offset: 10_000, duration: 5000 },
  { text: "c", offset: 30_000, duration: 5000 },
];

/** Build one choice per flag, marking each as correct / incorrect in order. */
function choicesWithCorrectness(correctnessFlags: boolean[]) {
  return correctnessFlags.map((is_correct, i) => ({ text: `opt${i}`, is_correct }));
}

describe("snapToSegmentBoundary", () => {
  it("snaps to the nearest segment start (in seconds)", () => {
    expect(snapToSegmentBoundary(12, transcriptSegments)).toBe(10);
    expect(snapToSegmentBoundary(2, transcriptSegments)).toBe(0);
    expect(snapToSegmentBoundary(100, transcriptSegments)).toBe(30);
  });

  it("returns a rounded, non-negative input when there are no segments", () => {
    expect(snapToSegmentBoundary(42.7, [])).toBe(43);
    expect(snapToSegmentBoundary(-5, [])).toBe(0);
  });
});

describe("normalizeGeneratedQuestion", () => {
  it("coerces a single-choice question to exactly one correct (keeps first)", () => {
    const question = normalizeGeneratedQuestion(
      { kind: "single", prompt: "?", position_seconds: 11, options: choicesWithCorrectness([true, true, false, false]) },
      transcriptSegments,
      0
    );
    expect(question).not.toBeNull();
    expect(question!.kind).toBe("single");
    expect(question!.options.filter((o) => o.is_correct)).toHaveLength(1);
    expect(question!.options[0].is_correct).toBe(true);
    expect(question!.position_seconds).toBe(10); // snapped
    expect(question!.order_index).toBe(0);
  });

  // UPDATED (C3): a question with ZERO correct options is now REJECTED rather than
  // silently defaulting option 0 to correct — we never fabricate an answer key.
  it("rejects a single-choice question with zero correct options", () => {
    const rejected = normalizeGeneratedQuestion(
      { kind: "single", prompt: "?", options: choicesWithCorrectness([false, false, false, false]) },
      transcriptSegments,
      2
    );
    expect(rejected).toBeNull();
  });

  it("keeps multiple correct for multi", () => {
    const multiQuestion = normalizeGeneratedQuestion(
      { kind: "multi", prompt: "?", options: choicesWithCorrectness([true, true, false, false]) },
      transcriptSegments,
      0
    );
    expect(multiQuestion!.options.filter((o) => o.is_correct)).toHaveLength(2);
  });

  // UPDATED (C3): multi with zero correct is likewise rejected, not coerced.
  it("rejects a multi-select question with zero correct options", () => {
    const rejected = normalizeGeneratedQuestion(
      { kind: "multi", prompt: "?", options: choicesWithCorrectness([false, false, false]) },
      transcriptSegments,
      0
    );
    expect(rejected).toBeNull();
  });

  // t8 (C3): when the model returns MORE than four options and the correct one
  // sits beyond the first four, it must be KEPT — not dropped by the 4-cap and the
  // key silently reassigned to option 0.
  it("keeps the correct option when more than four options are returned", () => {
    const question = normalizeGeneratedQuestion(
      {
        kind: "single",
        prompt: "?",
        options: [
          { text: "d0", is_correct: false },
          { text: "d1", is_correct: false },
          { text: "d2", is_correct: false },
          { text: "d3", is_correct: false },
          { text: "the-correct-one", is_correct: true }, // index 4, beyond the cap
          { text: "d5", is_correct: false },
        ],
      },
      transcriptSegments,
      0
    );
    expect(question).not.toBeNull();
    expect(question!.options).toHaveLength(4);
    const correctOptions = question!.options.filter((o) => o.is_correct);
    expect(correctOptions).toHaveLength(1);
    expect(correctOptions[0].base_text).toBe("the-correct-one");
  });

  it("keeps all correct options for multi when more than four are returned", () => {
    const question = normalizeGeneratedQuestion(
      {
        kind: "multi",
        prompt: "?",
        options: [
          { text: "d0", is_correct: false },
          { text: "d1", is_correct: false },
          { text: "d2", is_correct: false },
          { text: "c3", is_correct: true },
          { text: "c4", is_correct: true }, // both correct beyond first four
        ],
      },
      transcriptSegments,
      0
    );
    expect(question!.options).toHaveLength(4);
    const correctTexts = question!.options.filter((o) => o.is_correct).map((o) => o.base_text);
    expect(correctTexts).toContain("c3");
    expect(correctTexts).toContain("c4");
  });

  it("rejects questions with no prompt or fewer than two options", () => {
    expect(
      normalizeGeneratedQuestion({ kind: "single", prompt: "", options: choicesWithCorrectness([true, false]) }, transcriptSegments, 0)
    ).toBeNull();
    expect(
      normalizeGeneratedQuestion({ kind: "single", prompt: "?", options: choicesWithCorrectness([true]) }, transcriptSegments, 0)
    ).toBeNull();
  });

  it("trims blank options and caps at four", () => {
    const question = normalizeGeneratedQuestion(
      {
        kind: "single",
        prompt: "?",
        options: [
          { text: "a", is_correct: true },
          { text: "  ", is_correct: false },
          { text: "b", is_correct: false },
          { text: "c", is_correct: false },
          { text: "d", is_correct: false },
          { text: "e", is_correct: false },
        ],
      },
      transcriptSegments,
      0
    );
    expect(question!.options).toHaveLength(4);
    expect(question!.options.every((o) => o.base_text.trim().length > 0)).toBe(true);
  });
});

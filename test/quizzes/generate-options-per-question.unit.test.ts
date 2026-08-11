/**
 * options-per-question unit tests (spec §8).
 *
 * The cap is variable (3/4/5), which makes the "split correct BEFORE trimming"
 * ordering in `normalizeGeneratedQuestion` load-bearing rather than incidental:
 * at a cap of 3 the trim is far more likely to reach a correct option the model
 * placed late. These tests pin that lowering the cap trims DISTRACTORS and never
 * the answer key.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

import {
  normalizeGeneratedQuestion,
  generateQuizQuestions,
} from "@/lib/ai/generate";
import {
  isOptionsPerQuestion,
  DEFAULT_OPTIONS_PER_QUESTION,
} from "@/lib/ai/generationOptions";
import type { TranscriptSegment } from "@/lib/transcript";

const segments: TranscriptSegment[] = [
  { text: "the first topic is introduced here in detail", offset: 0, duration: 5000 },
  { text: "and then a second distinct topic follows on", offset: 20_000, duration: 5000 },
];

/** `n` options where only the one at `correctIndex` is correct. */
function optionsWithCorrectAt(n: number, correctIndex: number) {
  return Array.from({ length: n }, (_, i) => ({
    text: `opt${i}`,
    is_correct: i === correctIndex,
  }));
}

describe("isOptionsPerQuestion", () => {
  it("accepts only 3, 4 and 5", () => {
    expect(isOptionsPerQuestion(3)).toBe(true);
    expect(isOptionsPerQuestion(4)).toBe(true);
    expect(isOptionsPerQuestion(5)).toBe(true);
    expect(isOptionsPerQuestion(2)).toBe(false);
    expect(isOptionsPerQuestion(6)).toBe(false);
    expect(isOptionsPerQuestion("4")).toBe(false);
    expect(isOptionsPerQuestion(null)).toBe(false);
  });

  it("defaults to 4 — what every quiz generated before the option existed", () => {
    expect(DEFAULT_OPTIONS_PER_QUESTION).toBe(4);
  });
});

describe("normalizeGeneratedQuestion with a variable options cap", () => {
  it("emits exactly `cap` options when the model returns more", () => {
    for (const cap of [3, 4, 5] as const) {
      const q = normalizeGeneratedQuestion(
        { kind: "single", prompt: "?", position_seconds: 0, options: optionsWithCorrectAt(6, 0) },
        segments,
        0,
        cap
      );
      expect(q?.options).toHaveLength(cap);
    }
  });

  it("keeps a LATE correct option when trimming to 3 (the answer-key hazard)", () => {
    // The only correct option sits at index 5 — beyond a 3-cap. Trimming first
    // would drop it and silently re-key the question to option 0.
    const q = normalizeGeneratedQuestion(
      { kind: "single", prompt: "?", position_seconds: 0, options: optionsWithCorrectAt(6, 5) },
      segments,
      0,
      3
    );

    expect(q?.options).toHaveLength(3);
    const correct = q!.options.filter((o) => o.is_correct);
    expect(correct).toHaveLength(1);
    expect(correct[0].base_text).toBe("opt5");
  });

  it("keeps every correct option for a multi question at a 5-cap", () => {
    const q = normalizeGeneratedQuestion(
      {
        kind: "multi",
        prompt: "?",
        position_seconds: 0,
        options: [
          { text: "a", is_correct: true },
          { text: "b", is_correct: false },
          { text: "c", is_correct: true },
          { text: "d", is_correct: false },
          { text: "e", is_correct: false },
        ],
      },
      segments,
      0,
      5
    );

    expect(q?.options).toHaveLength(5);
    expect(q!.options.filter((o) => o.is_correct).map((o) => o.base_text)).toEqual([
      "a",
      "c",
    ]);
  });

  it("still yields exactly one correct for single, whatever the cap", () => {
    for (const cap of [3, 4, 5] as const) {
      const q = normalizeGeneratedQuestion(
        {
          kind: "single",
          prompt: "?",
          position_seconds: 0,
          // Several marked correct — single must coerce to exactly one.
          options: [
            { text: "a", is_correct: true },
            { text: "b", is_correct: true },
            { text: "c", is_correct: true },
            { text: "d", is_correct: false },
            { text: "e", is_correct: false },
          ],
        },
        segments,
        0,
        cap
      );
      expect(q!.options.filter((o) => o.is_correct)).toHaveLength(1);
    }
  });

  it("defaults to a 4-cap when no cap is passed", () => {
    const q = normalizeGeneratedQuestion(
      { kind: "single", prompt: "?", position_seconds: 0, options: optionsWithCorrectAt(6, 0) },
      segments,
      0
    );
    expect(q?.options).toHaveLength(4);
  });
});

describe("options-per-question in the prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMock.mockResolvedValue({ content: [{ type: "text", text: "[]" }] });
  });

  function promptSentToModel(): string {
    const call = createMock.mock.calls[0]?.[0] as
      | { messages: Array<{ content: string }> }
      | undefined;
    return call?.messages[0]?.content ?? "";
  }

  it("asks for the requested number of options", async () => {
    await generateQuizQuestions(segments, 1, "he", { optionsPerQuestion: 3 });
    expect(promptSentToModel()).toMatch(/Exactly 3 options each/);
  });

  it("shows an example block with exactly that many options", async () => {
    await generateQuizQuestions(segments, 1, "he", { optionsPerQuestion: 5 });

    const prompt = promptSentToModel();
    expect(prompt).toMatch(/Exactly 5 options each/);
    // The example must not contradict the instruction above it.
    const exampleOptionLines = prompt.match(/\{ "text": "\.\.\.", "is_correct": (true|false) \}/g);
    expect(exampleOptionLines).toHaveLength(5);
    expect(exampleOptionLines!.filter((l) => l.includes("true"))).toHaveLength(1);
  });

  it("asks for 4 by default", async () => {
    await generateQuizQuestions(segments, 1, "he");
    expect(promptSentToModel()).toMatch(/Exactly 4 options each/);
  });
});

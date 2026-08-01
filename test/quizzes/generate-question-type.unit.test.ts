/**
 * questionType unit tests (spec §8).
 *
 * The lever is deliberately ASYMMETRIC and these tests pin that asymmetry so it
 * reads as intentional rather than as a half-finished feature:
 *   • `single-only` is enforceable and lossless — coercion always yields exactly
 *     one correct option, whatever the model returned.
 *   • `multi-only` can only be requested. A genuine multi needs ≥2 correct
 *     answers and inventing one would fabricate an answer key, so a
 *     single-correct question is labelled `multi` (DB-legal) rather than dropped.
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
  isQuestionType,
  DEFAULT_QUESTION_TYPE,
} from "@/lib/ai/generate";
import type { TranscriptSegment } from "@/lib/transcript";

const segments: TranscriptSegment[] = [
  { text: "the first topic is introduced here in detail", offset: 0, duration: 5000 },
  { text: "and then a second distinct topic follows on", offset: 20_000, duration: 5000 },
];

/** A question the model returned as multi, with two genuinely correct options. */
const rawMulti = {
  kind: "multi",
  prompt: "?",
  position_seconds: 0,
  options: [
    { text: "a", is_correct: true },
    { text: "b", is_correct: true },
    { text: "c", is_correct: false },
    { text: "d", is_correct: false },
  ],
};

/** A question the model returned as single, with one correct option. */
const rawSingle = {
  kind: "single",
  prompt: "?",
  position_seconds: 0,
  options: [
    { text: "a", is_correct: true },
    { text: "b", is_correct: false },
    { text: "c", is_correct: false },
    { text: "d", is_correct: false },
  ],
};

describe("isQuestionType", () => {
  it("accepts only the three modes", () => {
    expect(isQuestionType("single-only")).toBe(true);
    expect(isQuestionType("allow-multi")).toBe(true);
    expect(isQuestionType("multi-only")).toBe(true);
    expect(isQuestionType("single")).toBe(false);
    expect(isQuestionType("")).toBe(false);
    expect(isQuestionType(1)).toBe(false);
    expect(isQuestionType(null)).toBe(false);
  });

  it("defaults to allow-multi — the pre-existing behaviour", () => {
    expect(DEFAULT_QUESTION_TYPE).toBe("allow-multi");
  });
});

describe("single-only coercion", () => {
  it("forces a model-returned multi down to single with exactly one correct", () => {
    const q = normalizeGeneratedQuestion(rawMulti, segments, 0, 4, "single-only");

    expect(q?.kind).toBe("single");
    expect(q!.options.filter((o) => o.is_correct)).toHaveLength(1);
    // The surplus correct option is demoted to a distractor, never dropped.
    expect(q!.options.map((o) => o.base_text)).toContain("b");
  });

  it("leaves an already-single question single", () => {
    const q = normalizeGeneratedQuestion(rawSingle, segments, 0, 4, "single-only");

    expect(q?.kind).toBe("single");
    expect(q!.options.filter((o) => o.is_correct)).toHaveLength(1);
  });
});

describe("multi-only coercion", () => {
  it("keeps a genuine multi as multi with all its correct answers", () => {
    const q = normalizeGeneratedQuestion(rawMulti, segments, 0, 4, "multi-only");

    expect(q?.kind).toBe("multi");
    expect(q!.options.filter((o) => o.is_correct).map((o) => o.base_text)).toEqual([
      "a",
      "b",
    ]);
  });

  it("labels a single-correct question multi rather than dropping it", () => {
    // Documents the accepted trade-off: we cannot invent a second correct answer,
    // and the DB permits multi with >=1 correct.
    const q = normalizeGeneratedQuestion(rawSingle, segments, 0, 4, "multi-only");

    expect(q).not.toBeNull();
    expect(q?.kind).toBe("multi");
    expect(q!.options.filter((o) => o.is_correct)).toHaveLength(1);
  });
});

describe("allow-multi", () => {
  it("defers to the model's own kind", () => {
    expect(normalizeGeneratedQuestion(rawMulti, segments, 0, 4, "allow-multi")?.kind).toBe(
      "multi"
    );
    expect(
      normalizeGeneratedQuestion(rawSingle, segments, 0, 4, "allow-multi")?.kind
    ).toBe("single");
  });

  it("is what an omitted questionType does", () => {
    expect(normalizeGeneratedQuestion(rawMulti, segments, 0, 4)?.kind).toBe("multi");
    expect(normalizeGeneratedQuestion(rawSingle, segments, 0, 4)?.kind).toBe("single");
  });
});

describe("questionType in the prompt", () => {
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

  it("sends a byte-identical prompt for allow-multi and for omitting it", async () => {
    await generateQuizQuestions(segments, 1, "he", { questionType: "allow-multi" });
    const explicit = promptSentToModel();

    vi.clearAllMocks();
    createMock.mockResolvedValue({ content: [{ type: "text", text: "[]" }] });
    await generateQuizQuestions(segments, 1, "he");
    const omitted = promptSentToModel();

    expect(explicit).toBe(omitted);
  });

  it("tells the model to always use single under single-only", async () => {
    await generateQuizQuestions(segments, 1, "he", { questionType: "single-only" });

    const prompt = promptSentToModel();
    expect(prompt).toMatch(/ALWAYS "single"/);
    expect(prompt).not.toMatch(/ALWAYS "multi"/);
  });

  it("asks for TWO OR MORE correct answers under multi-only", async () => {
    await generateQuizQuestions(segments, 1, "he", { questionType: "multi-only" });

    const prompt = promptSentToModel();
    expect(prompt).toMatch(/ALWAYS "multi"/);
    // The ≥2 request is what keeps relabelling a fallback rather than the norm.
    expect(prompt).toMatch(/TWO OR MORE correct answers/);
  });
});

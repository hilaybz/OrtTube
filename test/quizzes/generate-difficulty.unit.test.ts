import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

import { generateQuizQuestions } from "@/lib/ai/generate";
import type { TranscriptSegment } from "@/lib/transcript";

const segments: TranscriptSegment[] = [
  { text: "the first topic is introduced here in detail", offset: 0, duration: 5000 },
  { text: "and then a second distinct topic follows on", offset: 20_000, duration: 5000 },
];

function promptSentToModel(): string {
  const call = createMock.mock.calls[0]?.[0] as
    | { messages: Array<{ content: string }> }
    | undefined;
  return call?.messages[0]?.content ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  createMock.mockResolvedValue({
    content: [
      {
        type: "text",
        text: JSON.stringify([
          {
            position_seconds: 20,
            kind: "single",
            prompt: "p",
            explanation: "e",
            options: [
              { text: "a", is_correct: true },
              { text: "b", is_correct: false },
            ],
          },
        ]),
      },
    ],
  });
});

describe("generation difficulty", () => {
  it("adds no instruction for 'medium' — identical to omitting difficulty", async () => {
    await generateQuizQuestions(segments, 1, "he", { difficulty: "medium" });
    const withMedium = promptSentToModel();

    vi.clearAllMocks();
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "[]" }],
    });
    await generateQuizQuestions(segments, 1, "he");
    const withoutDifficulty = promptSentToModel();

    expect(withMedium).toBe(withoutDifficulty);
    expect(withMedium).not.toMatch(/Difficulty:/);
  });

  it("instructs the model to ask for recall when 'easy'", async () => {
    await generateQuizQuestions(segments, 1, "he", { difficulty: "easy" });

    const prompt = promptSentToModel();
    expect(prompt).toMatch(/Difficulty: EASY/);
    expect(prompt).not.toMatch(/Difficulty: HARD/);
  });

  it("instructs the model to require inference when 'hard'", async () => {
    await generateQuizQuestions(segments, 1, "he", { difficulty: "hard" });

    const prompt = promptSentToModel();
    expect(prompt).toMatch(/Difficulty: HARD/);
    expect(prompt).toMatch(/inference/i);
    expect(prompt).not.toMatch(/Difficulty: EASY/);
  });

  it("keeps difficulty independent of the append hints", async () => {
    await generateQuizQuestions(segments, 1, "he", {
      difficulty: "hard",
      avoidPrompts: ["an existing question"],
      baseOrderIndex: 4,
    });

    const prompt = promptSentToModel();
    expect(prompt).toMatch(/Difficulty: HARD/);
    expect(prompt).toMatch(/an existing question/);
  });

  it("still numbers appended questions from baseOrderIndex", async () => {
    const questions = await generateQuizQuestions(segments, 1, "he", {
      difficulty: "hard",
      baseOrderIndex: 4,
    });

    expect(questions[0]?.order_index).toBe(4);
  });
});

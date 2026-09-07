import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

import { generateQuizQuestions } from "@/lib/ai/generate";
import { SUPPORTED_LANGUAGES, type Language } from "@/lib/lang";
import type { TranscriptSegment } from "@/lib/transcript";

const englishSegments: TranscriptSegment[] = [
  { text: "photosynthesis turns light into chemical energy", offset: 0, duration: 5000 },
  { text: "and the second topic is cellular respiration", offset: 20_000, duration: 5000 },
];

const EXPECTED_LANGUAGE_NAME: Record<Language, string> = {
  he: "Hebrew (עברית)",
  ar: "Arabic (العربية)",
  en: "English",
};

function promptSentToModel(): string {
  const call = createMock.mock.calls.at(-1)?.[0] as
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

describe("generation language", () => {
  it("instructs the model to write in the quiz's base language", async () => {
    for (const baseLanguage of SUPPORTED_LANGUAGES) {
      await generateQuizQuestions(englishSegments, 1, baseLanguage);

      expect(promptSentToModel()).toContain(
        `Write every prompt, option and explanation in ${EXPECTED_LANGUAGE_NAME[baseLanguage]}, regardless of the transcript's language.`
      );
    }
  });

  it("names no language other than the quiz's base language", async () => {
    await generateQuizQuestions(englishSegments, 1, "he");

    const prompt = promptSentToModel();
    expect(prompt).not.toContain(EXPECTED_LANGUAGE_NAME.ar);
    expect(prompt).not.toMatch(/in English,/);
  });

  it("keeps the language instruction under every other generation lever", async () => {
    await generateQuizQuestions(englishSegments, 1, "ar", {
      difficulty: "hard",
      optionsPerQuestion: 5,
      questionType: "multi-only",
      avoidPrompts: ["an existing question"],
      baseOrderIndex: 3,
    });

    const prompt = promptSentToModel();
    expect(prompt).toContain(`in ${EXPECTED_LANGUAGE_NAME.ar}`);
    expect(prompt).toMatch(/Difficulty: HARD/);
    expect(prompt).toMatch(/an existing question/);
  });
});

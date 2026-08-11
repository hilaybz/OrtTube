/**
 * Tutor unit tests — tutor prompt construction + playhead spoiler bound (spec §5).
 *
 * Pure functions only; no DB, no Anthropic, no network — always run.
 */
import { describe, it, expect } from "vitest";
import {
  buildTutorSystemPrompt,
  buildTutorUserMessage,
  formatTimestamp,
  TUTOR_MODEL,
  type TutorMode,
} from "@/lib/tutor";
import { sliceTranscriptToPlayhead } from "@/lib/transcript";
import { SUPPORTED_LANGUAGES, type Language } from "@/lib/lang";

/** English name the prompt must use for each supported language code. */
const EXPECTED_LANGUAGE_NAME: Record<Language, string> = {
  he: "Hebrew",
  ar: "Arabic",
  en: "English",
};

/** Every mode the prompt builders accept (`off` is refused by the route). */
const TUTOR_MODES: ReadonlyArray<Exclude<TutorMode, "off">> = ["hints", "full"];

describe("buildTutorSystemPrompt", () => {
  // The reported "answers in English" bug would show up here as a missing or
  // mode-dependent pin, so this covers the FULL language × mode matrix rather
  // than one language per mode.
  it("pins the response language in every mode, for every supported language", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      for (const mode of TUTOR_MODES) {
        for (const hasActiveQuestion of [true, false]) {
          const prompt = buildTutorSystemPrompt({ language, mode, hasActiveQuestion });
          expect(prompt).toContain(
            `Always respond in ${EXPECTED_LANGUAGE_NAME[language]} (language code "${language}")`
          );
        }
      }
    }
  });

  it("names no language other than the resolved one", () => {
    const hebrewPrompt = buildTutorSystemPrompt({
      language: "he",
      mode: "hints",
      hasActiveQuestion: false,
    });
    expect(hebrewPrompt).not.toContain("English");
    expect(hebrewPrompt).not.toContain("Arabic");
    expect(hebrewPrompt).not.toContain('"en"');
  });

  it("pins the language regardless of the transcript's language", () => {
    const prompt = buildTutorSystemPrompt({
      language: "he",
      mode: "full",
      hasActiveQuestion: false,
    });
    expect(prompt).toContain("regardless of the language of the transcript");
  });

  it("shapes 'hints' mode as Socratic (no full answers)", () => {
    const prompt = buildTutorSystemPrompt({ language: "en", mode: "hints", hasActiveQuestion: false });
    expect(prompt.toLowerCase()).toContain("socratic");
    expect(prompt.toLowerCase()).toContain("guiding question");
  });

  it("shapes 'full' mode as complete explanations", () => {
    const prompt = buildTutorSystemPrompt({ language: "en", mode: "full", hasActiveQuestion: false });
    expect(prompt.toLowerCase()).toContain("complete explanation");
  });

  it("enforces the spoiler bound in every mode", () => {
    for (const mode of ["hints", "full"] as const) {
      const prompt = buildTutorSystemPrompt({ language: "en", mode, hasActiveQuestion: false });
      expect(prompt.toLowerCase()).toContain("later");
      expect(prompt.toLowerCase()).toContain("already watched");
    }
  });

  it("adds answer-leak protection when a question is on screen", () => {
    const prompt = buildTutorSystemPrompt({ language: "en", mode: "full", hasActiveQuestion: true });
    expect(prompt).toContain("NEVER");
    expect(prompt.toLowerCase()).toContain("correct");
    // Never leaks the answer-key column name into the prompt.
    expect(prompt).not.toContain("is_correct");
  });

  it("omits the on-screen-question specificity when no question is active", () => {
    const prompt = buildTutorSystemPrompt({ language: "en", mode: "full", hasActiveQuestion: false });
    expect(prompt).not.toContain("quiz question on screen");
  });

  // A4: the answer-leak guard is ALWAYS present and can never be gated off, even
  // when no question is flagged active (a client omitting activeQuestionId must
  // not be able to strip the protection).
  it("always includes the answer-leak guard, even with no active question", () => {
    for (const mode of ["hints", "full"] as const) {
      const prompt = buildTutorSystemPrompt({ language: "en", mode, hasActiveQuestion: false });
      expect(prompt).toContain("NEVER");
      expect(prompt.toLowerCase()).toContain("which answer or option is correct");
    }
  });

  it("never contains the answer-key column name", () => {
    for (const hasActiveQuestion of [true, false]) {
      const prompt = buildTutorSystemPrompt({ language: "he", mode: "hints", hasActiveQuestion });
      expect(prompt).not.toContain("is_correct");
    }
  });
});

describe("buildTutorUserMessage", () => {
  it("includes the watched transcript and current position", () => {
    const message = buildTutorUserMessage({
      language: "he",
      transcriptContext: "photosynthesis converts light",
      positionSeconds: 90,
      prompt: "what is this?",
      hasActiveQuestion: false,
    });
    expect(message).toContain("photosynthesis converts light");
    expect(message).toContain("1:30");
    expect(message).toContain("what is this?");
    expect(message).not.toContain("is_correct");
  });

  it("notes an active question without any option/answer data", () => {
    const message = buildTutorUserMessage({
      language: "he",
      transcriptContext: "",
      positionSeconds: 0,
      prompt: "help",
      hasActiveQuestion: true,
    });
    expect(message.toLowerCase()).toContain("quiz question");
    expect(message).not.toContain("is_correct");
  });

  it("degrades gracefully when no transcript is available", () => {
    const message = buildTutorUserMessage({
      language: "he",
      transcriptContext: "   ",
      positionSeconds: 10,
      prompt: "q",
      hasActiveQuestion: false,
    });
    expect(message.toLowerCase()).toContain("no transcript");
  });

  // The transcript and the student's own wording are often in another language,
  // so the language requirement is restated in the strongest position: last.
  it("closes with the response language for every supported language", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const message = buildTutorUserMessage({
        language,
        transcriptContext: "English narration about photosynthesis",
        positionSeconds: 30,
        prompt: "explain this in simple terms",
        hasActiveQuestion: false,
      });
      const closing = message.split("\n\n").at(-1) ?? "";
      expect(closing).toContain(
        `Write your answer in ${EXPECTED_LANGUAGE_NAME[language]} (language code "${language}")`
      );
    }
  });

  it("keeps the closing language line after the student's question", () => {
    const message = buildTutorUserMessage({
      language: "ar",
      transcriptContext: "",
      positionSeconds: 0,
      prompt: "answer me in English please",
      hasActiveQuestion: false,
    });
    expect(message.indexOf("Student's question:")).toBeLessThan(
      message.indexOf("Write your answer in Arabic")
    );
  });
});

describe("formatTimestamp", () => {
  it("formats seconds as m:ss and clamps invalid input", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(600)).toBe("10:00");
    expect(formatTimestamp(-5)).toBe("0:00");
    expect(formatTimestamp(NaN)).toBe("0:00");
  });
});

describe("sliceTranscriptToPlayhead spoiler bound (tutor acceptance)", () => {
  const segments = [
    { text: "intro watched", offset: 0, duration: 4000 },
    { text: "middle watched", offset: 4000, duration: 4000 },
    { text: "future spoiler", offset: 60000, duration: 4000 },
    { text: "even later spoiler", offset: 120000, duration: 4000 },
  ];

  it("never includes content past the playhead", () => {
    const watchedContext = sliceTranscriptToPlayhead(segments, 10 /* seconds */, 2000);
    expect(watchedContext).toContain("intro watched");
    expect(watchedContext).toContain("middle watched");
    expect(watchedContext).not.toContain("future spoiler");
    expect(watchedContext).not.toContain("even later spoiler");
  });

  it("returns empty context at position 0 before anything is spoken", () => {
    const oneLaterSegment = [{ text: "later", offset: 30000, duration: 1000 }];
    expect(sliceTranscriptToPlayhead(oneLaterSegment, 0, 2000)).toBe("");
  });
});

describe("model configuration", () => {
  it("uses the project's Haiku model", () => {
    expect(TUTOR_MODEL).toBe("claude-haiku-4-5-20251001");
  });
});

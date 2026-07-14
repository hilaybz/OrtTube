/**
 * AI-tutor prompt construction.
 *
 * Pure, dependency-free helpers so they can be unit-tested without Anthropic, a
 * database, or any environment. The Route Handler (`app/api/ask/route.ts`) does
 * the I/O: membership/mode check, transcript slicing, streaming, and logging.
 *
 * Hard invariants encoded here (tutor acceptance):
 *   - The prompt is built ONLY from the transcript excerpt the caller passes,
 *     which the route has already sliced to the playhead — so the tutor can
 *     never discuss content past the student's current position (spoiler bound).
 *   - `is_correct` (or any answer key) never appears: this module is never given
 *     option data, and when a quiz question is on screen the model is explicitly
 *     told to help with the concept but never reveal/confirm/point to the answer.
 *   - The response language is pinned to the student's resolved language
 *     regardless of the transcript's or the question's language.
 */

import type { Language } from "./lang";

/** Per-class tutor delivery mode (`class_quizzes.tutor_mode`). */
export type TutorMode = "off" | "hints" | "full";

/** Claude model + budget for tutoring (Haiku, per project conventions). */
export const TUTOR_MODEL = "claude-haiku-4-5-20251001";
export const TUTOR_MAX_TOKENS = 400;

/** Approximate token budget for the playhead-bounded transcript context. */
export const TRANSCRIPT_TOKEN_CAP = 2000;

/** Human-readable language names the model is instructed to answer in. */
const LANGUAGE_NAMES: Record<Language, string> = {
  he: "Hebrew",
  ar: "Arabic",
  en: "English",
};

/** Format seconds as `m:ss` for the "current position" hint. */
export function formatTimestamp(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface TutorPromptInput {
  /** Resolved response language (shared `resolveLanguage`). */
  language: Language;
  /** Per-class mode. `off` is handled by the route (403) and never reaches here. */
  mode: Exclude<TutorMode, "off">;
  /** Whether a quiz question is currently on screen (activeQuestionId present). */
  hasActiveQuestion: boolean;
}

/**
 * The system prompt: role, spoiler bound, answer-leak protection, mode shaping,
 * and the language pin. Deliberately contains no transcript and no question
 * content — those live in the user message so this stays cacheable/stable.
 */
export function buildTutorSystemPrompt(input: TutorPromptInput): string {
  const { language, mode, hasActiveQuestion } = input;
  const languageName = LANGUAGE_NAMES[language];

  const parts: string[] = [
    "You are a helpful AI tutor for a student watching an educational video as part of a class assignment.",
    // Spoiler bound — the route only ever gives content up to the playhead.
    "You are given an excerpt of the video's transcript covering ONLY what the student has already watched, up to their current position. " +
      "Discuss and explain that watched content only. Never reveal, summarize, guess at, or hint at anything that happens later in the video — even if the student asks; if they ask about content beyond what they've watched, tell them to keep watching.",
  ];

  // Mode shaping.
  if (mode === "hints") {
    parts.push(
      "Teaching style: be Socratic. Offer hints, nudges, and guiding questions that lead the student to work it out themselves. " +
        "Do not hand over full explanations or the final answer — guide, don't solve."
    );
  } else {
    parts.push(
      "Teaching style: give clear, complete explanations of the content the student has already watched, at a level appropriate for a student."
    );
  }

  // Answer-leak protection — ALWAYS present, in every mode, regardless of whether
  // a question is flagged active. This guard must never be gate-off-able: a client
  // that omits `activeQuestionId` (or the server not detecting an in-progress
  // attempt) must NOT be able to strip it, or the tutor could be coaxed into
  // confirming an answer between quiz pop-ups.
  parts.push(
    "IMPORTANT: this is a graded quiz assignment. You must NEVER state, confirm, deny, hint at, or point to which answer or option is correct for any quiz question. " +
      "Do not tell the student which choice to pick or evaluate a specific option's correctness. If they ask you for the answer, encourage them to reason it out using the concepts instead."
  );

  // When a question is known to be on screen, add specificity on top of the guard
  // (it only ADDS context — it can never remove the always-on protection above).
  if (hasActiveQuestion) {
    parts.push(
      "The student currently has a quiz question on screen. You may help them understand the underlying concepts, but keep strictly to the rule above: never reveal or confirm the correct option."
    );
  }

  // Language pin — answer cross-lingually regardless of transcript language.
  parts.push(
    `Always respond in ${languageName} (language code "${language}"), regardless of the language of the transcript or of the student's question. ` +
      "Keep answers concise: 2–4 sentences unless more detail is clearly needed."
  );

  return parts.join("\n\n");
}

export interface TutorUserMessageInput {
  /** Playhead-bounded transcript text (may be empty when none is cached). */
  transcriptContext: string;
  /** The student's current position, in seconds. */
  positionSeconds: number;
  /** The student's question. */
  prompt: string;
  /** Whether a quiz question is currently on screen. */
  hasActiveQuestion: boolean;
}

/**
 * The user turn: the watched-transcript context, the current position, an
 * (optional) note that a question is active, and the student's actual question.
 * No option text or answer key is ever included.
 */
export function buildTutorUserMessage(input: TutorUserMessageInput): string {
  const { transcriptContext, positionSeconds, prompt, hasActiveQuestion } = input;

  const sections: string[] = [];

  const transcript = transcriptContext.trim();
  sections.push(
    transcript
      ? `Transcript of what the student has watched so far (up to ${formatTimestamp(
          positionSeconds
        )}):\n${transcript}`
      : "No transcript is available for the watched portion of this video; rely on the student's question and general knowledge of the topic, but still never discuss content beyond their current position."
  );

  sections.push(`The student's current position in the video is ${formatTimestamp(positionSeconds)}.`);

  if (hasActiveQuestion) {
    sections.push(
      "A quiz question is currently on the student's screen. Help with the concept only — do not reveal or confirm its answer."
    );
  }

  sections.push(`Student's question: ${prompt}`);

  return sections.join("\n\n");
}

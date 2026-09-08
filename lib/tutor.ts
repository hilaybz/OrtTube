/**
 * Hard invariants encoded here (tutor acceptance):
 *   - The prompt is built ONLY from the transcript excerpt the caller passes,
 *     which the route has already sliced to the playhead — so the tutor can
 *     never discuss content past the student's current position (spoiler bound).
 *   - `is_correct` (or any answer key) never appears: this module is never given
 *     option data, and when a quiz question is on screen the model is explicitly
 *     told to help with the concept but never reveal/confirm/point to the answer.
 *   - The response language is pinned to the student's resolved language
 *     regardless of the transcript's or the question's language. The pin is
 *     stated in the system prompt AND restated as the last line of the user
 *     turn, because everything between them — the framing, the transcript, the
 *     student's own question — can be in another language, and the final
 *     instruction in the context is the one a model follows most reliably.
 */

import type { Language } from "./lang";

export type TutorMode = "off" | "hints" | "full";

export const TUTOR_MODEL = "claude-sonnet-5";
export const TUTOR_MAX_TOKENS = 400;

export const TRANSCRIPT_TOKEN_CAP = 2000;

const LANGUAGE_NAMES: Record<Language, string> = {
  he: "Hebrew",
  ar: "Arabic",
  en: "English",
};

export function formatTimestamp(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface TutorPromptInput {
  language: Language;
  mode: Exclude<TutorMode, "off">;
  hasActiveQuestion: boolean;
}

export function buildTutorSystemPrompt(input: TutorPromptInput): string {
  const { language, mode, hasActiveQuestion } = input;
  const languageName = LANGUAGE_NAMES[language];

  const parts: string[] = [
    "You are a helpful AI tutor for a student watching an educational video as part of a class assignment.",
    "You are given an excerpt of the video's transcript covering ONLY what the student has already watched, up to their current position. " +
      "Discuss and explain that watched content only. Never reveal, summarize, guess at, or hint at anything that happens later in the video — even if the student asks; if they ask about content beyond what they've watched, tell them to keep watching.",
  ];

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

  parts.push(
    `Always respond in ${languageName} (language code "${language}"), regardless of the language of the transcript or of the student's question. ` +
      "Keep answers concise: 2–4 sentences unless more detail is clearly needed."
  );

  return parts.join("\n\n");
}

export interface TutorUserMessageInput {
  language: Language;
  transcriptContext: string;
  positionSeconds: number;
  prompt: string;
  hasActiveQuestion: boolean;
}

export function buildTutorUserMessage(input: TutorUserMessageInput): string {
  const { language, transcriptContext, positionSeconds, prompt, hasActiveQuestion } =
    input;

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

  // Last line in the context, and deliberately so: the transcript above and the
  // student's question are frequently in a different language from the one the
  // answer must be in, and this is the position a model weights most heavily.
  sections.push(
    `Write your answer in ${LANGUAGE_NAMES[language]} (language code "${language}"), even if the transcript above or the question itself is in another language.`
  );

  return sections.join("\n\n");
}

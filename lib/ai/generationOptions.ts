/**
 * The levers a teacher can set on an AI generation run, with their allowed
 * values, defaults and type guards.
 *
 * This module is a LEAF: it imports nothing, and in particular nothing that
 * reaches the Anthropic SDK. The HTTP layer validates a request body against
 * these guards, the editor UI mirrors them in its controls, and the generator
 * consumes them — none of which should have to pull an AI client in just to know
 * what "medium" or 4 options means.
 */

/** How many answer options each generated question carries. */
export type OptionsPerQuestion = 3 | 4 | 5;

export const OPTIONS_PER_QUESTION_VALUES: readonly OptionsPerQuestion[] = [3, 4, 5];
export const DEFAULT_OPTIONS_PER_QUESTION: OptionsPerQuestion = 4;

export function isOptionsPerQuestion(v: unknown): v is OptionsPerQuestion {
  return (
    typeof v === "number" &&
    (OPTIONS_PER_QUESTION_VALUES as readonly number[]).includes(v)
  );
}

/**
 * How demanding the generated questions should be. `medium` is the default and
 * deliberately contributes NO prompt instruction — only `easy` / `hard` steer
 * the model.
 */
export type GenerationDifficulty = "easy" | "medium" | "hard";

export const GENERATION_DIFFICULTIES: readonly GenerationDifficulty[] = [
  "easy",
  "medium",
  "hard",
];

export function isGenerationDifficulty(v: unknown): v is GenerationDifficulty {
  return (
    typeof v === "string" &&
    (GENERATION_DIFFICULTIES as readonly string[]).includes(v)
  );
}

/**
 * Whether questions may have more than one correct answer. `allow-multi` is the
 * default and leaves the model's own per-question judgement intact.
 *
 * The two directions are NOT equally enforceable, and that asymmetry is
 * deliberate rather than an oversight:
 *   • `single-only` is enforceable — the single path keeps the first correct
 *     option and DROPS any surplus correct ones. It is not lossless: an option
 *     the model marked correct is discarded rather than shown as wrong, because
 *     displaying it as wrong would mis-grade a student who picked it.
 *   • `multi-only` can only be REQUESTED. A genuine multi needs ≥2 correct
 *     answers, and inventing one would fabricate an answer key — which the
 *     generator refuses to do anywhere. So the prompt asks for ≥2, and a
 *     question that still comes back with one correct answer is labelled `multi`
 *     anyway (the DB allows multi with ≥1) rather than dropped.
 */
export type QuestionType = "single-only" | "allow-multi" | "multi-only";

export const QUESTION_TYPES: readonly QuestionType[] = [
  "single-only",
  "allow-multi",
  "multi-only",
];
export const DEFAULT_QUESTION_TYPE: QuestionType = "allow-multi";

export function isQuestionType(v: unknown): v is QuestionType {
  return typeof v === "string" && (QUESTION_TYPES as readonly string[]).includes(v);
}

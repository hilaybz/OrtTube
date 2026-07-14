/**
 * Question fixtures (builders). Small, honest builders so a quiz's questions read
 * as data, not option soup. `teacher.authorQuiz({ questions })` and
 * `teacher.addQuestion` consume these to create the real structural rows + answer
 * key + base (and optional extra-language) text.
 */

export interface OptionFixture {
  is_correct: boolean;
  order_index: number;
  base_text: string;
}

export interface QuestionFixture {
  kind: "single" | "multi";
  positionSeconds: number;
  orderIndex: number;
  basePrompt: string;
  baseExplanation?: string;
  options: OptionFixture[];
  /** Extra-language prompts, e.g. `{ en: "..." }` (base is written by the RPC). */
  promptLangs?: Record<string, string>;
  /** Extra-language option text keyed by the option's base text, e.g.
   *  `{ "כן": { en: "yes" } }`. */
  optionLangs?: Record<string, Record<string, string>>;
}

/** A single-answer question: exactly one `correct` among the choices. */
export function singleChoice(spec: {
  prompt: string;
  at: number;
  order?: number;
  explanation?: string;
  correct: string;
  distractors: string[];
  promptLangs?: Record<string, string>;
  optionLangs?: Record<string, Record<string, string>>;
}): QuestionFixture {
  const texts = [spec.correct, ...spec.distractors];
  return {
    kind: "single",
    positionSeconds: spec.at,
    orderIndex: spec.order ?? 0,
    basePrompt: spec.prompt,
    baseExplanation: spec.explanation,
    promptLangs: spec.promptLangs,
    optionLangs: spec.optionLangs,
    options: texts.map((base_text, i) => ({
      is_correct: base_text === spec.correct,
      order_index: i,
      base_text,
    })),
  };
}

/** A multi-answer question: every string in `correct` is a right answer. */
export function multiChoice(spec: {
  prompt: string;
  at: number;
  order?: number;
  explanation?: string;
  correct: string[];
  distractors: string[];
  promptLangs?: Record<string, string>;
  optionLangs?: Record<string, Record<string, string>>;
}): QuestionFixture {
  const texts = [...spec.correct, ...spec.distractors];
  return {
    kind: "multi",
    positionSeconds: spec.at,
    orderIndex: spec.order ?? 0,
    basePrompt: spec.prompt,
    baseExplanation: spec.explanation,
    promptLangs: spec.promptLangs,
    optionLangs: spec.optionLangs,
    options: texts.map((base_text, i) => ({
      is_correct: spec.correct.includes(base_text),
      order_index: i,
      base_text,
    })),
  };
}

/**
 * A raw question builder for edge cases the tidy `singleChoice`/`multiChoice`
 * builders can't express — e.g. a "single" with two correct options, or a "multi"
 * with none, used to exercise the correctness guards. Options are given as
 * `{ text, correct }` in display order.
 */
export function question(spec: {
  kind: "single" | "multi";
  prompt: string;
  at: number;
  order?: number;
  explanation?: string;
  options: { text: string; correct: boolean }[];
  promptLangs?: Record<string, string>;
  optionLangs?: Record<string, Record<string, string>>;
}): QuestionFixture {
  return {
    kind: spec.kind,
    positionSeconds: spec.at,
    orderIndex: spec.order ?? 0,
    basePrompt: spec.prompt,
    baseExplanation: spec.explanation,
    promptLangs: spec.promptLangs,
    optionLangs: spec.optionLangs,
    options: spec.options.map((o, i) => ({
      is_correct: o.correct,
      order_index: i,
      base_text: o.text,
    })),
  };
}

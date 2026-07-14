/**
 * Question fixture builders for the e2e DSL — turn a question into readable data
 * instead of hand-rolled option arrays. The shape matches the
 * POST /api/quizzes/[id]/questions body.
 */

/**
 * A single-answer question: exactly one `correct` choice among the options.
 *   singleChoice({ prompt: "2+2?", at: 30, correct: "4", distractors: ["3","5"] })
 */
export function singleChoice({ prompt, at, order = 0, explanation, correct, distractors }) {
  const texts = [correct, ...distractors];
  return {
    kind: "single",
    positionSeconds: at,
    orderIndex: order,
    basePrompt: prompt,
    baseExplanation: explanation,
    options: texts.map((base_text, i) => ({
      is_correct: base_text === correct,
      order_index: i,
      base_text,
    })),
  };
}

/**
 * A multi-answer question: every string in `correct` is a right answer.
 *   multiChoice({ prompt: "which are even?", at: 60, correct: ["2","4"], distractors: ["3","5"] })
 */
export function multiChoice({ prompt, at, order = 0, explanation, correct, distractors }) {
  const texts = [...correct, ...distractors];
  return {
    kind: "multi",
    positionSeconds: at,
    orderIndex: order,
    basePrompt: prompt,
    baseExplanation: explanation,
    options: texts.map((base_text, i) => ({
      is_correct: correct.includes(base_text),
      order_index: i,
      base_text,
    })),
  };
}

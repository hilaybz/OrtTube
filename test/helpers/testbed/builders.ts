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
  promptLangs?: Record<string, string>;
  optionLangs?: Record<string, Record<string, string>>;
}

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

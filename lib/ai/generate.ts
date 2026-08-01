import Anthropic from "@anthropic-ai/sdk";
import type { Language } from "@/lib/lang";
import type { TranscriptSegment } from "@/lib/transcript";
import { LANGUAGE_NAMES } from "./translate";

/**
 * AI strategic quiz generation.
 *
 * Claude reads the WHOLE transcript (in its original language) and chooses
 * `count` strategic positions at natural topic boundaries, producing questions
 * DIRECTLY in the quiz's `base_language` (not through a pivot). Each generated
 * `position_seconds` is snapped to a transcript segment boundary so a pop-up
 * never interrupts mid-sentence. The answer key is emitted on the option rows
 * (`is_correct`), never as a positional index — correctness is language
 * independent.
 *
 * The pure helpers (`snapToSegmentBoundary`, `normalizeGeneratedQuestion`) are
 * exported for unit testing without a network round-trip.
 */

const MODEL = "claude-haiku-4-5-20251001";

/**
 * How many answer options each generated question carries. The default of 4 is
 * what every quiz generated before this was a choice, so it stays the fallback
 * for callers that don't ask.
 */
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
 * deliberately contributes NO prompt instruction, so an unchanged generate call
 * produces the same prompt — and therefore the same class of output — as before
 * difficulty existed. Only `easy` / `hard` steer the model.
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
 * default and leaves the model's own per-question judgement intact, exactly as
 * before this was a choice.
 *
 * The two directions are NOT equally enforceable, and that asymmetry is
 * deliberate rather than an oversight:
 *   • `single-only` is enforceable — the single path keeps the first correct
 *     option and DROPS any surplus correct ones. It is not lossless: an option
 *     the model marked correct is discarded rather than shown as wrong, because
 *     displaying it as wrong would mis-grade a student who picked it.
 *   • `multi-only` can only be REQUESTED. A genuine multi needs ≥2 correct
 *     answers, and inventing one would fabricate an answer key — which this
 *     module refuses to do anywhere. So the prompt asks for ≥2, and a question
 *     that still comes back with one correct answer is labelled `multi` anyway
 *     (the DB allows multi with ≥1) rather than dropped.
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

/**
 * The two prompt rules that depend on the question type — which `kind` to emit,
 * and how many options may be correct. They are returned TOGETHER because they
 * must agree: stating the correctness rule separately let a generic "a multi
 * needs at least one" contradict `multi-only`'s demand for two or more, and
 * re-introduced "multi" as a concept immediately after `single-only` forbade it.
 *
 * `allow-multi` returns the original two lines verbatim, so a default generate
 * sends a byte-identical prompt to one that predates this option.
 */
function questionTypeRules(
  questionType: QuestionType,
  optionsCap: OptionsPerQuestion
): string {
  const optionCount = `- Exactly ${optionsCap} options each; mark each option's "is_correct" boolean.`;
  switch (questionType) {
    case "single-only":
      return `- "kind": ALWAYS "single" — every question must have exactly one correct answer. Never produce a multi-answer question.
${optionCount} Exactly ONE option is correct; every other option must be wrong.`;
    case "multi-only":
      return `- "kind": ALWAYS "multi" — every question must have TWO OR MORE correct answers. Choose moments in the video that genuinely support several correct answers.
${optionCount} At least TWO options must be marked correct, and at least one must be wrong.`;
    case "allow-multi":
      return `- "kind": "single" (exactly one correct) for most; "multi" (two or more correct) only when the content genuinely supports it.
${optionCount} A "single" question must have exactly one correct; a "multi" at least one.`;
  }
}

/**
 * The instruction appended for a given difficulty, or "" for `medium`.
 * Phrased in terms of the cognitive demand and the distractors, since those are
 * what actually make a multiple-choice item easy or hard — not prompt wording.
 */
function difficultyInstruction(difficulty: GenerationDifficulty): string {
  switch (difficulty) {
    case "easy":
      return "- Difficulty: EASY. Ask about facts stated explicitly and memorably in the transcript. Distractors should be clearly wrong to anyone who watched attentively.\n";
    case "hard":
      return "- Difficulty: HARD. Require inference, or connecting ideas introduced at different points in the video, rather than recall of a single stated fact. Distractors must be genuinely plausible — each should reflect a realistic misunderstanding — while remaining unambiguously wrong.\n";
    case "medium":
      return "";
  }
}

export interface GeneratedOption {
  base_text: string;
  is_correct: boolean;
  order_index: number;
}

export interface GeneratedQuestion {
  kind: "single" | "multi";
  position_seconds: number;
  order_index: number;
  base_prompt: string;
  base_explanation: string;
  options: GeneratedOption[];
}

/** Raw (untrusted) shape the model is asked to emit. */
interface RawQuestion {
  position_seconds?: number;
  kind?: string;
  prompt?: string;
  explanation?: string;
  options?: Array<{ text?: string; is_correct?: boolean }>;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Snaps `positionSeconds` to the START (in seconds) of the transcript segment
 * closest to it, so the pop-up fires on a sentence boundary rather than mid-word.
 * Returns the input unchanged when there are no segments.
 */
export function snapToSegmentBoundary(
  positionSeconds: number,
  segments: TranscriptSegment[]
): number {
  if (segments.length === 0) return Math.max(0, Math.round(positionSeconds));
  let best = segments[0].offset / 1000;
  let bestDiff = Math.abs(best - positionSeconds);
  for (const seg of segments) {
    const start = seg.offset / 1000;
    const diff = Math.abs(start - positionSeconds);
    if (diff < bestDiff) {
      best = start;
      bestDiff = diff;
    }
  }
  return Math.max(0, Math.round(best));
}

/**
 * Validates + normalizes one raw model question into a persistable shape, or
 * returns null if it cannot be salvaged (no prompt, fewer than 2 usable options,
 * or NO correct option at all — we never fabricate an answer key).
 *
 * CRITICAL ordering: correctness is computed on the FULL cleaned option set
 * BEFORE trimming to `optionsCap`. Trimming first (the old behaviour) could drop
 * a correct option the model placed beyond the cap, after which the question was
 * silently keyed to option 0 — a wrong answer key. Instead we keep the correct
 * option(s), fill the remaining slots with distractors, then recompute is_correct
 * on the final set:
 *   • single → exactly one correct (the first correct) + distractors up to the cap,
 *   • multi  → all correct (capped) + distractors up to the cap.
 * This ordering is what makes a *variable* cap safe: lowering it to 3 trims
 * distractors, never the answer key.
 * If the model returned zero correct options, the question is unsalvageable and
 * is skipped (rather than defaulting option 0 to correct).
 *
 * `questionType` overrides the model's own `kind` where it is enforceable —
 * see the type's docs for why `multi-only` is a request rather than a guarantee.
 */
export function normalizeGeneratedQuestion(
  raw: RawQuestion,
  segments: TranscriptSegment[],
  orderIndex: number,
  optionsCap: OptionsPerQuestion = DEFAULT_OPTIONS_PER_QUESTION,
  questionType: QuestionType = DEFAULT_QUESTION_TYPE
): GeneratedQuestion | null {
  const prompt = (raw.prompt ?? "").trim();
  if (!prompt) return null;

  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  const cleaned = rawOptions
    .map((o) => ({ text: (o?.text ?? "").trim(), is_correct: Boolean(o?.is_correct) }))
    .filter((o) => o.text.length > 0);
  if (cleaned.length < 2) return null;

  // Decided BEFORE the correct/distractor split below, so the requested kind is
  // what drives which trimming branch runs — and the "split correct before
  // trimming" ordering keeps protecting the answer key either way.
  const kind: "single" | "multi" =
    questionType === "single-only"
      ? "single"
      : questionType === "multi-only"
        ? "multi"
        : raw.kind === "multi"
          ? "multi"
          : "single";

  // Split BEFORE trimming so a correct option is never dropped by the cap.
  const correct = cleaned.filter((o) => o.is_correct);
  const distractors = cleaned.filter((o) => !o.is_correct);
  if (correct.length === 0) return null; // no answer key → skip, never fabricate.

  // Assemble the final ≤cap option set, keeping the required correct option(s).
  let picked: { text: string; is_correct: boolean }[];
  if (kind === "single") {
    const correctOne = correct[0];
    // Surplus correct options are DROPPED, never demoted to distractors: keeping
    // them would display a genuinely correct answer as wrong, and grading is
    // exact-set-match, so a student picking one would be marked incorrect.
    // If that leaves fewer than 2 options the question is discarded below.
    const fillers = distractors;
    picked = [correctOne, ...fillers]
      .slice(0, optionsCap)
      .map((o) => ({ text: o.text, is_correct: o === correctOne }));
  } else {
    const keptCorrect = correct.slice(0, optionsCap);
    picked = [...keptCorrect, ...distractors]
      .slice(0, optionsCap)
      .map((o) => ({ text: o.text, is_correct: keptCorrect.includes(o) }));
  }
  if (picked.length < 2) return null;

  const options: GeneratedOption[] = picked.map((o, i) => ({
    base_text: o.text,
    is_correct: o.is_correct,
    order_index: i,
  }));

  return {
    kind,
    position_seconds: snapToSegmentBoundary(
      typeof raw.position_seconds === "number" ? raw.position_seconds : 0,
      segments
    ),
    order_index: orderIndex,
    base_prompt: prompt,
    base_explanation: (raw.explanation ?? "").trim(),
    options,
  };
}

// ── Timestamped transcript builder (whole-video context for the model) ────────

function fmtTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function buildTimestampedTranscript(
  segments: TranscriptSegment[],
  blockSeconds = 20,
  maxChars = 28000
): string {
  const blocks = new Map<number, string[]>();
  for (const seg of segments) {
    const blockStart = Math.floor(seg.offset / 1000 / blockSeconds) * blockSeconds;
    const text = seg.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (!blocks.has(blockStart)) blocks.set(blockStart, []);
    blocks.get(blockStart)!.push(text);
  }
  const lines = [...blocks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, texts]) => `[${fmtTimestamp(start)} | ${start}s] ${texts.join(" ")}`);

  let out = "";
  for (const line of lines) {
    if (out.length + line.length + 1 > maxChars) break;
    out += line + "\n";
  }
  return out.trim();
}

// ── Model call ────────────────────────────────────────────────────────────────

/**
 * Generates `count` strategically-placed questions in `baseLanguage` from the
 * whole transcript. Positions are snapped to segment boundaries and answer keys
 * are coerced to the correctness invariant. Returns fewer than `count` only if
 * the model under-delivers or some questions are unsalvageable. Node/server only
 * (needs `ANTHROPIC_API_KEY`).
 *
 * When APPENDING to a quiz that already has questions, pass:
 *   • `opts.baseOrderIndex` — the next free `order_index`, so the new questions
 *     continue past the existing ones instead of colliding at 0..n-1;
 *   • `opts.avoidPrompts` — the existing base-language prompts, so the model is
 *     told not to repeat or paraphrase them.
 *
 * `opts.difficulty` steers cognitive demand; it defaults to `medium`, which adds
 * no instruction and so leaves the prompt identical to a call without it.
 * `opts.optionsPerQuestion` sets how many answers each question carries (3/4/5,
 * default 4) — it drives both the instruction and the normalizer's cap.
 */
export async function generateQuizQuestions(
  segments: TranscriptSegment[],
  count: number,
  baseLanguage: Language,
  opts: {
    baseOrderIndex?: number;
    avoidPrompts?: string[];
    difficulty?: GenerationDifficulty;
    optionsPerQuestion?: OptionsPerQuestion;
    questionType?: QuestionType;
  } = {}
): Promise<GeneratedQuestion[]> {
  const n = Math.max(1, Math.min(20, Math.floor(count)));
  const baseOrderIndex = Math.max(0, Math.floor(opts.baseOrderIndex ?? 0));
  const difficultyBlock = difficultyInstruction(opts.difficulty ?? "medium");
  const optionsCap = opts.optionsPerQuestion ?? DEFAULT_OPTIONS_PER_QUESTION;
  const questionType = opts.questionType ?? DEFAULT_QUESTION_TYPE;
  // The example must agree with the rules above it on BOTH counts — options and
  // correct answers — or the model is handed a shape that contradicts them, and
  // a concrete example tends to win over prose.
  const exampleKind = questionType === "multi-only" ? "multi" : "single";
  const exampleCorrect = questionType === "multi-only" ? 2 : 1;
  const exampleOptions = Array.from({ length: optionsCap }, (_, i) =>
    `      { "text": "...", "is_correct": ${i < exampleCorrect} }`
  ).join(",\n");
  const avoidPrompts = (opts.avoidPrompts ?? [])
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const transcript = buildTimestampedTranscript(segments);
  if (transcript.length < 40) return [];

  const avoidBlock = avoidPrompts.length
    ? `\nThe quiz already has these questions — do NOT repeat or paraphrase them; cover different content and moments:\n${avoidPrompts
        .map((p) => `- ${p}`)
        .join("\n")}\n`
    : "";

  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1024 + n * 320,
    system:
      "You are an educational quiz author. You read a full video transcript and design comprehension questions at natural topic boundaries. Respond with a single JSON array only — no markdown, no commentary.",
    messages: [
      {
        role: "user",
        content: `Here is a timestamped transcript of an educational video. Each line is "[MM:SS | <seconds>s] spoken text"; use the <seconds> value for positions.

"""
${transcript}
"""

Design exactly ${n} multiple-choice comprehension questions spread across the WHOLE video at natural topic boundaries (topic shifts) — not clustered together.

Rules:
- Write every prompt, option and explanation in ${LANGUAGE_NAMES[baseLanguage]}, regardless of the transcript's language.
- "position_seconds": an integer number of seconds where the question should pop up (the moment AFTER the relevant content was covered). Use the <seconds> markers.
${questionTypeRules(questionType, optionsCap)}
- Questions must be specific to the content, not generic.
${difficultyBlock}${avoidBlock}
Return ONLY a JSON array:
[
  {
    "position_seconds": 123,
    "kind": "${exampleKind}",
    "prompt": "...",
    "explanation": "...",
    "options": [
${exampleOptions}
    ]
  }
]`,
      },
    ],
  });

  const rawText = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "";
  const match = rawText.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let parsed: RawQuestion[];
  try {
    parsed = JSON.parse(match[0]) as RawQuestion[];
  } catch {
    return [];
  }

  const result: GeneratedQuestion[] = [];
  for (const raw of parsed.slice(0, n)) {
    const q = normalizeGeneratedQuestion(
      raw,
      segments,
      result.length + baseOrderIndex,
      optionsCap,
      questionType
    );
    if (q) result.push(q);
  }
  return result;
}

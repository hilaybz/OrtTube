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
const OPTIONS_PER_QUESTION = 4;

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
 * BEFORE trimming to four. Trimming first (the old behaviour) could drop a
 * correct option that the model placed at index ≥4, after which the question was
 * silently keyed to option 0 — a wrong answer key. Instead we keep the correct
 * option(s), fill the remaining slots with distractors, then recompute is_correct
 * on the final four:
 *   • single → exactly one correct (the first correct) + up to 3 distractors,
 *   • multi  → all correct (capped at 4) + distractors up to 4.
 * If the model returned zero correct options, the question is unsalvageable and
 * is skipped (rather than defaulting option 0 to correct).
 */
export function normalizeGeneratedQuestion(
  raw: RawQuestion,
  segments: TranscriptSegment[],
  orderIndex: number
): GeneratedQuestion | null {
  const prompt = (raw.prompt ?? "").trim();
  if (!prompt) return null;

  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  const cleaned = rawOptions
    .map((o) => ({ text: (o?.text ?? "").trim(), is_correct: Boolean(o?.is_correct) }))
    .filter((o) => o.text.length > 0);
  if (cleaned.length < 2) return null;

  const kind: "single" | "multi" = raw.kind === "multi" ? "multi" : "single";

  // Split BEFORE trimming so a correct option is never dropped by the 4-cap.
  const correct = cleaned.filter((o) => o.is_correct);
  const distractors = cleaned.filter((o) => !o.is_correct);
  if (correct.length === 0) return null; // no answer key → skip, never fabricate.

  // Assemble the final ≤4-option set, keeping the required correct option(s).
  let picked: { text: string; is_correct: boolean }[];
  if (kind === "single") {
    const correctOne = correct[0];
    // Leftover "correct" options become distractors (single needs exactly one).
    const fillers = [...distractors, ...correct.slice(1)];
    picked = [correctOne, ...fillers]
      .slice(0, OPTIONS_PER_QUESTION)
      .map((o) => ({ text: o.text, is_correct: o === correctOne }));
  } else {
    const keptCorrect = correct.slice(0, OPTIONS_PER_QUESTION);
    picked = [...keptCorrect, ...distractors]
      .slice(0, OPTIONS_PER_QUESTION)
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
 */
export async function generateQuizQuestions(
  segments: TranscriptSegment[],
  count: number,
  baseLanguage: Language
): Promise<GeneratedQuestion[]> {
  const n = Math.max(1, Math.min(20, Math.floor(count)));
  const transcript = buildTimestampedTranscript(segments);
  if (transcript.length < 40) return [];

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
- "kind": "single" (exactly one correct) for most; "multi" (two or more correct) only when the content genuinely supports it.
- Exactly ${OPTIONS_PER_QUESTION} options each; mark each option's "is_correct" boolean. A "single" question must have exactly one correct; a "multi" at least one.
- Questions must be specific to the content, not generic.

Return ONLY a JSON array:
[
  {
    "position_seconds": 123,
    "kind": "single",
    "prompt": "...",
    "explanation": "...",
    "options": [
      { "text": "...", "is_correct": true },
      { "text": "...", "is_correct": false },
      { "text": "...", "is_correct": false },
      { "text": "...", "is_correct": false }
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
    const q = normalizeGeneratedQuestion(raw, segments, result.length);
    if (q) result.push(q);
  }
  return result;
}

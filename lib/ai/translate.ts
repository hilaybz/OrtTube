import Anthropic from "@anthropic-ai/sdk";
import type { Language } from "@/lib/lang";

/**
 * AI translation primitive for the multilingual content layer.
 *
 * This module translates TEXT ONLY. The answer key (`is_correct`),
 * `position_seconds` and option identity live on the structural rows and are
 * never passed through here — so a translation can never desync correctness.
 *
 * `translateTexts` batches every string of a quiz into a single Claude call and
 * returns a map keyed by the caller's opaque ids, so lib/quiz.ts can fan the
 * results back out to `question_translations` / `option_translations`.
 */

const MODEL = "claude-haiku-4-5-20251001";

export const LANGUAGE_NAMES: Record<Language, string> = {
  he: "Hebrew (עברית)",
  ar: "Arabic (العربية)",
  en: "English",
};

export interface TranslationItem {
  /** Opaque, stable id chosen by the caller (e.g. `q:<uuid>:prompt`). */
  id: string;
  /** The source text in `from` language. */
  text: string;
}

/**
 * Translates each item's text from `from` to `to`, returning a map
 * `id -> translated text`. Empty-text items are echoed unchanged. On a malformed
 * model response the returned map may omit some ids; callers must treat a missing
 * id as "leave untranslated" (the read path then falls back to base_language).
 *
 * Node/server only (needs `ANTHROPIC_API_KEY`).
 */
export async function translateTexts(
  items: TranslationItem[],
  from: Language,
  to: Language
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const nonEmpty = items.filter((it) => it.text && it.text.trim().length > 0);
  // Echo blank items straight through.
  for (const it of items) {
    if (!it.text || it.text.trim().length === 0) out[it.id] = it.text ?? "";
  }
  if (nonEmpty.length === 0) return out;
  if (from === to) {
    for (const it of nonEmpty) out[it.id] = it.text;
    return out;
  }

  const payload = nonEmpty.map((it) => ({ id: it.id, text: it.text }));
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: Math.min(8192, 512 + payload.length * 160),
    system:
      "You are a professional translator for educational quiz content. You translate meaning faithfully and idiomatically, preserving any domain terminology. Respond with a single JSON object only — no markdown, no commentary.",
    messages: [
      {
        role: "user",
        content: `Translate the "text" of each item from ${LANGUAGE_NAMES[from]} to ${LANGUAGE_NAMES[to]}.

Rules:
- Return a JSON object mapping each item's "id" to its translated text.
- Keep the ids EXACTLY as given. Do not add, drop, or merge ids.
- Translate only the text; do not add explanations or quotation marks.
- Preserve numbers, names and proper nouns.

Items:
${JSON.stringify(payload)}

Return ONLY the JSON object, e.g. {"<id>": "<translated>", ...}`,
      },
    ],
  });

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return out; // caller falls back to base for every id
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return out;
  }
  for (const it of nonEmpty) {
    const v = parsed[it.id];
    if (typeof v === "string" && v.trim().length > 0) out[it.id] = v;
  }
  return out;
}

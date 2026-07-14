import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "@/lib/lang";
import { fetchVideoMetadata } from "@/lib/youtube";
import { translateTexts, type TranslationItem } from "@/lib/ai/translate";
import type { GeneratedQuestion } from "@/lib/ai/generate";

/**
 * Quiz service layer. Thin, typed TypeScript wrappers over the
 * SECURITY DEFINER authoring RPCs plus the lazy cached
 * translation orchestration (`ensureTranslation`).
 *
 * Clients are typed as the un-parameterised `SupabaseClient` on purpose (the same
 * convention as lib/video.ts / lib/transcriptCache.ts): these functions compile
 * independently of `lib/supabase/types.ts` being regenerated for the RPCs this
 * task adds. Authoring RPCs must be called with the caller's AUTHENTICATED client
 * (server.ts) so `auth.uid()` resolves to the owner; only `ensureTranslation`
 * uses a service-role client (it fills content on behalf of any reader).
 */

/** Stable error thrown when an RPC raises one of its documented codes. */
export class QuizError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "QuizError";
    this.code = code;
  }
}

function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new QuizError(res.error.message);
  return res.data;
}

// ── Authoring ─────────────────────────────────────────────────────────────────

export interface CreatedQuiz {
  quiz_id: string;
  video_id: string;
  youtube_video_id: string;
  school_id: string;
  base_language: Language;
  title: string | null;
  visibility: "private" | "shared";
  transcript_status: "pending" | "ready" | "unavailable";
  created_at: string;
}

/**
 * Atomically create the canonical video (deduped, never downgraded) AND the
 * first quiz on it in one transaction. YouTube metadata is fetched
 * in Node here, then handed to the `create_quiz_for_video` RPC which does the
 * video-upsert + quiz-insert together. Subsequent quizzes on the same video call
 * this too (the video upsert is a no-op then).
 */
export async function createQuizForVideo(
  client: SupabaseClient,
  params: { youtubeId: string; baseLanguage: Language; title?: string | null }
): Promise<CreatedQuiz> {
  const meta = await fetchVideoMetadata(params.youtubeId);
  const data = unwrap(
    await client.rpc("create_quiz_for_video", {
      p_youtube_id: params.youtubeId,
      p_video_title: meta.title,
      p_duration_seconds: meta.durationSeconds,
      p_base_language: params.baseLanguage,
      p_quiz_title: params.title ?? null,
    })
  );
  return data as unknown as CreatedQuiz;
}

export interface OptionInput {
  option_id?: string;
  is_correct: boolean;
  order_index: number;
  base_text: string;
}

export interface UpsertQuestionInput {
  quizId: string;
  questionId?: string | null;
  kind: "single" | "multi";
  positionSeconds: number;
  orderIndex: number;
  basePrompt: string;
  baseExplanation?: string | null;
  options: OptionInput[];
  source?: "authored" | "generated";
}

/** Upsert one question + its base-language text + option set. Returns question id. */
export async function upsertQuestion(
  client: SupabaseClient,
  input: UpsertQuestionInput
): Promise<string> {
  const data = unwrap(
    await client.rpc("upsert_question", {
      p_quiz_id: input.quizId,
      p_question_id: input.questionId ?? null,
      p_kind: input.kind,
      p_position_seconds: Math.round(input.positionSeconds),
      p_order_index: input.orderIndex,
      p_base_prompt: input.basePrompt,
      p_base_explanation: input.baseExplanation ?? null,
      p_options: input.options,
      p_source: input.source ?? "authored",
    })
  );
  return data as unknown as string;
}

export async function softDeleteQuestion(
  client: SupabaseClient,
  questionId: string
): Promise<void> {
  unwrap(await client.rpc("soft_delete_question", { p_question_id: questionId }));
}

export async function softDeleteOption(
  client: SupabaseClient,
  optionId: string
): Promise<void> {
  unwrap(await client.rpc("soft_delete_option", { p_option_id: optionId }));
}

export async function updateQuiz(
  client: SupabaseClient,
  quizId: string,
  patch: { title?: string | null; visibility?: "private" | "shared"; baseLanguage?: Language }
): Promise<void> {
  unwrap(
    await client.rpc("update_quiz", {
      p_quiz_id: quizId,
      p_title: patch.title ?? null,
      p_visibility: patch.visibility ?? null,
      p_base_language: patch.baseLanguage ?? null,
    })
  );
}

export async function softDeleteQuiz(client: SupabaseClient, quizId: string): Promise<void> {
  unwrap(await client.rpc("soft_delete_quiz", { p_quiz_id: quizId }));
}

export interface MyQuiz {
  quiz_id: string;
  title: string | null;
  base_language: Language;
  visibility: "private" | "shared";
  video_id: string;
  youtube_video_id: string;
  video_title: string | null;
  transcript_status: "pending" | "ready" | "unavailable";
  question_count: number;
  created_at: string;
}

/** The signed-in teacher's own-quizzes library (incl. unassigned). */
export async function listMyQuizzes(client: SupabaseClient): Promise<MyQuiz[]> {
  const data = unwrap(await client.rpc("list_my_quizzes", {}));
  return (data as unknown as MyQuiz[]) ?? [];
}

/**
 * Persist AI-generated questions via `upsert_question` (source='generated').
 * Returns the created question ids in order. A single failing question aborts
 * (the RPC raises); callers decide whether to surface partial success.
 */
export async function persistGeneratedQuestions(
  client: SupabaseClient,
  quizId: string,
  questions: GeneratedQuestion[]
): Promise<string[]> {
  const ids: string[] = [];
  for (const q of questions) {
    const id = await upsertQuestion(client, {
      quizId,
      kind: q.kind,
      positionSeconds: q.position_seconds,
      orderIndex: q.order_index,
      basePrompt: q.base_prompt,
      baseExplanation: q.base_explanation,
      options: q.options.map((o) => ({
        is_correct: o.is_correct,
        order_index: o.order_index,
        base_text: o.base_text,
      })),
      source: "generated",
    });
    ids.push(id);
  }
  return ids;
}

// ── Translation (lazy, cached, single-flight) ─────────────────────────────────

export type EnsureTranslationStatus =
  | "filled" // this call translated ≥0 rows and holds/held the claim
  | "already_base" // requested language IS the base language — nothing to do
  | "claim_lost" // another filler is running; caller falls back to base
  | "quiz_not_found"; // quiz missing or soft-deleted

export interface EnsureTranslationResult {
  status: EnsureTranslationStatus;
  language: Language;
  questionsTranslated: number;
  optionsTranslated: number;
}

interface QTransRow {
  question_id: string;
  language: string;
  prompt: string;
  explanation: string | null;
}
interface OTransRow {
  option_id: string;
  language: string;
  text: string;
}

/**
 * CONTRACT — publish this signature for the assignment hook.
 *
 *   ensureTranslation(quizId, language, opts?) => EnsureTranslationResult
 *
 * Ensures every non-deleted question/option of `quizId` has a
 * `question_translations` / `option_translations` row in `language`, translating
 * from the quiz's base_language rows via Claude and caching them. Idempotent
 * (already-present rows are skipped) and single-flight per (quiz, language) via
 * the `translation_jobs` claim marker — long AI I/O is NOT done under a DB
 * lock; losers return `claim_lost` and the reader falls back to base.
 *
 * TEXT ONLY: never touches `is_correct`, `position_seconds`, or option identity,
 * so the answer key can never desync.
 *
 * Requires a privileged (service-role) client. Pass `opts.client` (tests / a
 * caller that already has one); otherwise a service client is constructed lazily
 * so class-assignment callers can invoke `ensureTranslation(quizId, classLanguage)`
 * best-effort. `opts.translate` overrides the AI call (tests).
 */
export async function ensureTranslation(
  quizId: string,
  language: Language,
  opts?: {
    client?: SupabaseClient;
    translate?: (
      items: TranslationItem[],
      from: Language,
      to: Language
    ) => Promise<Record<string, string>>;
    ttlSeconds?: number;
  }
): Promise<EnsureTranslationResult> {
  const client = opts?.client ?? (await defaultServiceClient());
  const translate = opts?.translate ?? translateTexts;

  const quizRes = await client
    .from("quizzes")
    .select("base_language, deleted_at")
    .eq("id", quizId)
    .maybeSingle();
  const quiz = quizRes.data as { base_language: string; deleted_at: string | null } | null;
  if (!quiz || quiz.deleted_at) {
    return { status: "quiz_not_found", language, questionsTranslated: 0, optionsTranslated: 0 };
  }
  const base = quiz.base_language as Language;
  if (language === base) {
    return { status: "already_base", language, questionsTranslated: 0, optionsTranslated: 0 };
  }

  const claim = await client.rpc("claim_translation_job", {
    p_quiz_id: quizId,
    p_language: language,
    p_ttl_seconds: opts?.ttlSeconds ?? 120,
  });
  if (claim.error) throw new QuizError(claim.error.message);
  if (claim.data !== true) {
    return { status: "claim_lost", language, questionsTranslated: 0, optionsTranslated: 0 };
  }

  try {
    // Live questions of this quiz.
    const qRes = await client
      .from("questions")
      .select("id")
      .eq("quiz_id", quizId)
      .is("deleted_at", null);
    const qids = ((qRes.data as { id: string }[] | null) ?? []).map((r) => r.id);
    if (qids.length === 0) {
      return { status: "filled", language, questionsTranslated: 0, optionsTranslated: 0 };
    }

    const qtRes = await client
      .from("question_translations")
      .select("question_id, language, prompt, explanation")
      .in("question_id", qids);
    const qtrans = (qtRes.data as QTransRow[] | null) ?? [];

    const oRes = await client
      .from("question_options")
      .select("id, question_id")
      .in("question_id", qids)
      .is("deleted_at", null);
    const options = (oRes.data as { id: string; question_id: string }[] | null) ?? [];
    const oids = options.map((o) => o.id);

    const otrans: OTransRow[] = [];
    if (oids.length > 0) {
      const otRes = await client
        .from("option_translations")
        .select("option_id, language, text")
        .in("option_id", oids);
      otrans.push(...((otRes.data as OTransRow[] | null) ?? []));
    }

    // Index base + target presence.
    const qBase = new Map<string, QTransRow>();
    const qHasTarget = new Set<string>();
    for (const r of qtrans) {
      if (r.language === base) qBase.set(r.question_id, r);
      if (r.language === language) qHasTarget.add(r.question_id);
    }
    const oBase = new Map<string, string>();
    const oHasTarget = new Set<string>();
    for (const r of otrans) {
      if (r.language === base) oBase.set(r.option_id, r.text);
      if (r.language === language) oHasTarget.add(r.option_id);
    }

    // Collect the strings that still need a target-language row.
    const items: TranslationItem[] = [];
    const needQuestions: string[] = [];
    for (const qid of qids) {
      const b = qBase.get(qid);
      if (!b || qHasTarget.has(qid)) continue;
      needQuestions.push(qid);
      items.push({ id: `q:${qid}:prompt`, text: b.prompt });
      if (b.explanation && b.explanation.trim().length > 0) {
        items.push({ id: `q:${qid}:expl`, text: b.explanation });
      }
    }
    const needOptions: string[] = [];
    for (const o of options) {
      const b = oBase.get(o.id);
      if (b === undefined || oHasTarget.has(o.id)) continue;
      needOptions.push(o.id);
      items.push({ id: `o:${o.id}`, text: b });
    }

    if (items.length === 0) {
      return { status: "filled", language, questionsTranslated: 0, optionsTranslated: 0 };
    }

    const map = await translate(items, base, language);

    // Fan out. A missing translation id → skip that row (read falls back to base).
    const qRows: Array<{
      question_id: string;
      language: string;
      prompt: string;
      explanation: string | null;
      source: string;
    }> = [];
    for (const qid of needQuestions) {
      const prompt = map[`q:${qid}:prompt`];
      if (!prompt) continue;
      const expl = map[`q:${qid}:expl`];
      qRows.push({
        question_id: qid,
        language,
        prompt,
        explanation: expl ?? null,
        source: "translated",
      });
    }
    const oRows: Array<{ option_id: string; language: string; text: string }> = [];
    for (const oid of needOptions) {
      const text = map[`o:${oid}`];
      if (!text) continue;
      oRows.push({ option_id: oid, language, text });
    }

    if (qRows.length > 0) {
      const ins = await client
        .from("question_translations")
        .upsert(qRows, { onConflict: "question_id,language", ignoreDuplicates: true });
      if (ins.error) throw new QuizError(ins.error.message);
    }
    if (oRows.length > 0) {
      const ins = await client
        .from("option_translations")
        .upsert(oRows, { onConflict: "option_id,language", ignoreDuplicates: true });
      if (ins.error) throw new QuizError(ins.error.message);
    }

    return {
      status: "filled",
      language,
      questionsTranslated: qRows.length,
      optionsTranslated: oRows.length,
    };
  } finally {
    await client.rpc("release_translation_job", { p_quiz_id: quizId, p_language: language });
  }
}

/**
 * Lazily import the service-role client factory so this module can be imported in
 * contexts (tests, pure callers passing their own client) that never construct
 * one — and so `import "server-only"` inside the factory doesn't leak to callers
 * that only use the authoring wrappers.
 */
async function defaultServiceClient(): Promise<SupabaseClient> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  return createServiceClient() as unknown as SupabaseClient;
}

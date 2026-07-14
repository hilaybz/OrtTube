/**
 * Translation integration tests — lazy cached translation + single-flight claim.
 *
 * A teacher authors a quiz through the actor DSL (`test/helpers/testbed`), then
 * `ensureTranslation` — the server-side fill path — is driven directly with a
 * DETERMINISTIC fake translator (no network) so we assert the DB fan-out:
 * target-language rows are created, the answer key (`is_correct`) is never touched,
 * and re-running is a no-op. Also covers the `translation_jobs` claim marker
 * (winner/loser + release).
 *
 * Runs at the integration/gate step. Skipped when the local DB is unreachable.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPool, closePool, getServiceClient } from "../helpers/db";
import {
  freshTestbed,
  singleChoice,
  type Testbed,
  type Teacher,
  type Quiz,
} from "../helpers/testbed";
import { ensureTranslation } from "@/lib/quiz";
import type { TranslationItem } from "@/lib/ai/translate";
import type { Language } from "@/lib/lang";

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
const online = await dbReachable();

/** Deterministic stand-in for the AI translator: prefixes each text with the target language. */
const translateByPrefixing = async (
  items: TranslationItem[],
  _from: Language,
  to: Language
): Promise<Record<string, string>> =>
  Object.fromEntries(items.map((it) => [it.id, `${to}:${it.text}`]));

// ── Out-of-band reads used only for assertions ────────────────────────────────

/** The answer key of a quiz — option ids + their `is_correct` bit, in display order. */
async function answerKey(quiz: Quiz) {
  const res = await getPool().query(
    `SELECT qo.id, qo.is_correct FROM public.question_options qo
     JOIN public.questions q ON q.id = qo.question_id
     WHERE q.quiz_id=$1 ORDER BY qo.order_index`,
    [quiz.id]
  );
  return res.rows;
}

/** The question-level translations of a quiz in a language. */
async function questionTranslations(quiz: Quiz, language: string) {
  const res = await getPool().query(
    `SELECT prompt, explanation, source FROM public.question_translations qt
     JOIN public.questions q ON q.id = qt.question_id
     WHERE q.quiz_id=$1 AND qt.language=$2`,
    [quiz.id, language]
  );
  return res.rows;
}

/** The option texts of a quiz in a language, in display order. */
async function optionTexts(quiz: Quiz, language: string): Promise<string[]> {
  const res = await getPool().query<{ text: string }>(
    `SELECT ot.text FROM public.option_translations ot
     JOIN public.question_options qo ON qo.id = ot.option_id
     JOIN public.questions q ON q.id = qo.question_id
     WHERE q.quiz_id=$1 AND ot.language=$2 ORDER BY qo.order_index`,
    [quiz.id, language]
  );
  return res.rows.map((r) => r.text);
}

describe.skipIf(!online)("translation", () => {
  let testbed: Testbed;
  let teacher: Teacher;
  let quiz: Quiz;
  // The privileged fill path: `ensureTranslation` writes content on behalf of any reader.
  const serviceClient = getServiceClient() as unknown as SupabaseClient;

  beforeEach(async () => {
    testbed = await freshTestbed();
    const school = await testbed.createSchool("Riverside High");
    teacher = await school.enrollTeacher({ name: "Ada" });
    quiz = await teacher.authorQuiz({
      baseLanguage: "he",
      questions: [
        singleChoice({
          prompt: "מה זה?",
          at: 10,
          explanation: "כי כך.",
          correct: "נכון",
          distractors: ["לא נכון"],
        }),
      ],
    });
  });

  afterAll(async () => {
    await closePool();
  });

  it("fills target-language rows without touching the answer key", async () => {
    const before = await answerKey(quiz);

    const result = await ensureTranslation(quiz.id, "ar", {
      client: serviceClient,
      translate: translateByPrefixing,
    });
    expect(result.status).toBe("filled");
    expect(result.questionsTranslated).toBe(1);
    expect(result.optionsTranslated).toBe(2);

    const arabicQuestions = await questionTranslations(quiz, "ar");
    expect(arabicQuestions).toHaveLength(1);
    expect(arabicQuestions[0]).toMatchObject({
      prompt: "ar:מה זה?",
      explanation: "ar:כי כך.",
      source: "translated",
    });

    expect(await optionTexts(quiz, "ar")).toEqual(["ar:נכון", "ar:לא נכון"]);

    // Answer key unchanged.
    const after = await answerKey(quiz);
    expect(after).toEqual(before);
  });

  it("is idempotent — a second run translates nothing new", async () => {
    await ensureTranslation(quiz.id, "ar", {
      client: serviceClient,
      translate: translateByPrefixing,
    });
    const second = await ensureTranslation(quiz.id, "ar", {
      client: serviceClient,
      translate: translateByPrefixing,
    });
    expect(second.status).toBe("filled");
    expect(second.questionsTranslated).toBe(0);
    expect(second.optionsTranslated).toBe(0);
  });

  it("requesting the base language is a no-op (already_base)", async () => {
    const result = await ensureTranslation(quiz.id, "he", {
      client: serviceClient,
      translate: translateByPrefixing,
    });
    expect(result.status).toBe("already_base");
  });

  it("reports quiz_not_found for a soft-deleted quiz", async () => {
    await quiz.softDelete();
    const result = await ensureTranslation(quiz.id, "ar", {
      client: serviceClient,
      translate: translateByPrefixing,
    });
    expect(result.status).toBe("quiz_not_found");
  });

  it("claim_translation_job is single-flight (winner, loser, then release re-opens)", async () => {
    const claim = () =>
      serviceClient.rpc("claim_translation_job", {
        p_quiz_id: quiz.id,
        p_language: "en",
        p_ttl_seconds: 120,
      });

    const winner = await claim();
    expect(winner.data).toBe(true);

    const loser = await claim();
    expect(loser.data).toBe(false); // loser

    await serviceClient.rpc("release_translation_job", {
      p_quiz_id: quiz.id,
      p_language: "en",
    });

    const reclaimed = await claim();
    expect(reclaimed.data).toBe(true); // reclaimable after release
  });
});

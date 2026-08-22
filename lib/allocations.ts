import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "@/lib/lang";
import {
  assignQuizToClass,
  ClassError,
  type AssignmentResult,
  type TutorMode,
} from "@/lib/classes";
import {
  ensureTranslation as defaultEnsureTranslation,
  type EnsureTranslationResult,
} from "@/lib/quiz";
import type { TranslationItem } from "@/lib/ai/translate";

/**
 * Quiz-side allocation reads + bulk-assign. Companion to `lib/classes.ts`,
 * which owns the class-side (single-class) reads/writes — this file is the
 * mirror direction (per-quiz) plus the one operation that's genuinely
 * quiz-side-only: assigning to several classes in one action.
 */

function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new ClassError(res.error.message);
  return res.data;
}

// ── Editor's own allocation list (every state) ────────────────────────────────

export interface QuizAllocation {
  class_id: string;
  class_name: string;
  class_language: Language;
  tutor_mode: TutorMode;
  max_attempts: number | null;
  published: boolean;
  available_from: string | null;
  available_until: string | null;
  assigned_at: string;
}

/** Owner-facing: every allocation of a quiz, any state (draft/scheduled/live/done). */
export async function listQuizAllocations(
  client: SupabaseClient,
  quizId: string
): Promise<QuizAllocation[]> {
  const data = unwrap(
    await client.rpc("list_quiz_allocations", { p_quiz_id: quizId })
  );
  return (data as unknown as QuizAllocation[]) ?? [];
}

// ── Card tags (library + dashboard landing page) ──────────────────────────────

export interface ClassTag {
  class_id: string;
  class_name: string;
}

export interface QuizAllocationTags {
  quiz_id: string;
  /** Classes whose students can see the quiz right now. */
  live: ClassTag[];
  /** Classes published but not yet inside their window. */
  scheduled: ClassTag[];
  /** Classes whose window has already closed (`allocationState`'s `done`). */
  closed: ClassTag[];
}

/**
 * The caller's own quizzes that have at least one allocation, split into the
 * three buckets the card UI and the library's status filter read: `live` and
 * `scheduled` become the card's `זמין` / `מתוזמן` line, and `closed` is what
 * lets "the window ended" be told apart from "never published" — with only
 * two buckets, both arrived as two empty arrays.
 *
 * A quiz whose allocations are all drafts still appears with all three arrays
 * empty (that's the `טיוטה` line, not a disappearing card); a quiz with no
 * allocation at all is absent entirely.
 *
 * Hand-typed against the RPC's `jsonb`, like the rest of `@/lib` —
 * `146_quiz_allocation_tags_closed.sql` is the shape's source of truth.
 */
export async function listMyQuizAllocationTags(
  client: SupabaseClient
): Promise<QuizAllocationTags[]> {
  const data = unwrap(await client.rpc("list_my_quiz_allocation_tags", {}));
  return (data as unknown as QuizAllocationTags[]) ?? [];
}

// ── Bulk-assign ────────────────────────────────────────────────────────────────

export interface BulkAssignResult {
  assigned: AssignmentResult[];
  failed: { classId: string; code: string }[];
}

/**
 * Assign a quiz to several classes at once with one shared set of delivery
 * settings, each becoming its own independent allocation (editable
 * afterward per class, same as a single assign). A server-side loop over the
 * existing `assign_quiz_to_class` RPC — one call per class — rather than a new
 * atomic multi-row RPC, matching the ad hoc (non-persistent-group) shape
 * decided for cluster-assignment. `Promise.allSettled` so one class failing
 * (e.g. a stale id no longer valid) doesn't block the others.
 *
 * The per-call eager-translation hook is suppressed here and instead fired
 * once per DISTINCT target language actually needed, after every assignment
 * settles — assigning to five classes that all read `he` would otherwise kick
 * off five identical translation jobs for one language.
 */
export async function bulkAssignQuizToClasses(
  client: SupabaseClient,
  params: {
    quizId: string;
    classIds: string[];
    tutorMode?: TutorMode;
    maxAttempts?: number | null;
    published?: boolean;
    availableFrom?: string | null;
    availableUntil?: string | null;
  },
  opts?: {
    translate?: (
      items: TranslationItem[],
      from: Language,
      to: Language
    ) => Promise<Record<string, string>>;
  }
): Promise<BulkAssignResult> {
  const settled = await Promise.allSettled(
    params.classIds.map((classId) =>
      assignQuizToClass(
        client,
        {
          classId,
          quizId: params.quizId,
          tutorMode: params.tutorMode,
          maxAttempts: params.maxAttempts,
          published: params.published,
          availableFrom: params.availableFrom,
          availableUntil: params.availableUntil,
        },
        // Suppress the per-call hook; translation is fired once per distinct
        // language below instead.
        { awaitTranslation: false, ensureTranslation: async () => noopTranslation }
      )
    )
  );

  const assigned: AssignmentResult[] = [];
  const failed: { classId: string; code: string }[] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      assigned.push(outcome.value);
    } else {
      const err = outcome.reason;
      failed.push({
        classId: params.classIds[i],
        code: err instanceof ClassError ? err.code : "assign_failed",
      });
    }
  });

  const targetLanguages = new Set(
    assigned
      .filter((a) => a.class_language !== a.base_language)
      .map((a) => a.class_language)
  );
  const ensure = defaultEnsureTranslation;
  // Fire-and-forget, matching the single-class assign route
  // (app/api/classes/[id]/quizzes/route.ts passes awaitTranslation: false for
  // the same reason): awaiting here would block the HTTP response on live
  // Claude calls for every distinct language among the selected classes —
  // worse for bulk-assign than the single-class path, since there are more
  // classes and therefore more chances to hit several different languages at
  // once. The reader path re-fills lazily if a translation hasn't landed yet.
  void Promise.all(
    [...targetLanguages].map(async (language) => {
      try {
        await ensure(params.quizId, language, { translate: opts?.translate });
      } catch {
        // best-effort: a translation failure must not fail the bulk assign.
      }
    })
  );

  return { assigned, failed };
}

const noopTranslation: EnsureTranslationResult = {
  status: "filled",
  language: "he",
  questionsTranslated: 0,
  optionsTranslated: 0,
};

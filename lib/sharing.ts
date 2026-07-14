import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "@/lib/lang";

/**
 * Sharing service layer. Thin, typed TypeScript
 * wrappers over the SECURITY DEFINER sharing RPCs:
 *
 *   • listSharedQuizzes — the same-school shared-quiz browse surface.
 *   • cloneQuiz         — deep-copy a readable quiz into a new private copy.
 *
 * Clients are typed as the un-parameterised `SupabaseClient` on purpose (same
 * convention as lib/quiz.ts / lib/classes.ts): these functions compile
 * independently of `lib/supabase/types.ts` being regenerated for the RPCs this
 * task adds. Both must be called with the caller's AUTHENTICATED (RLS-subject)
 * client so `auth.uid()` inside the RPC resolves to the acting teacher.
 */

/** Stable error thrown when a sharing RPC raises one of its documented codes. */
export class SharingError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "SharingError";
    this.code = code;
  }
}

function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new SharingError(res.error.message);
  return res.data;
}

export interface SharedQuiz {
  quiz_id: string;
  title: string | null;
  base_language: Language;
  visibility: "private" | "shared";
  video_id: string;
  youtube_video_id: string;
  video_title: string | null;
  transcript_status: "pending" | "ready" | "unavailable";
  question_count: number;
  author_id: string;
  author_name: string | null;
  is_own: boolean;
  created_at: string;
}

/**
 * The same-school shared-quiz catalog for the browse-and-clone surface. Returns
 * every non-deleted `shared` quiz in the signed-in teacher's school (including
 * their own, flagged via `is_own`). A student (or deactivated teacher) gets an
 * empty list — shared reads are teacher-only so the answer key never leaks.
 */
export async function listSharedQuizzes(
  client: SupabaseClient
): Promise<SharedQuiz[]> {
  const data = unwrap(await client.rpc("list_shared_quizzes", {}));
  return (data as unknown as SharedQuiz[]) ?? [];
}

/**
 * Deep-copy a quiz the caller may read (their own, or a shared quiz in their
 * school) into a NEW private quiz owned by the caller, with `cloned_from_id` set
 * to the source. The shared video row is reused (never duplicated); all
 * non-deleted questions/options and their translations are copied. Attempts and
 * answers are NOT copied. Returns the new quiz id.
 *
 * Throws `SharingError` with `not_authorized` (not an active teacher, or no read
 * access to the source), `quiz_not_found`, or `quiz_deleted`.
 */
export async function cloneQuiz(
  client: SupabaseClient,
  sourceQuizId: string
): Promise<string> {
  const data = unwrap(
    await client.rpc("clone_quiz", { p_source_quiz_id: sourceQuizId })
  );
  return data as unknown as string;
}

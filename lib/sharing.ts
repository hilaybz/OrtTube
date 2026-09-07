import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "@/lib/lang";
import type { AuthorQuiz } from "@/lib/quizAuthor";

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
  channel_name: string | null;
  transcript_status: "pending" | "ready" | "unavailable";
  question_count: number;
  author_id: string;
  author_name: string | null;
  is_own: boolean;
  created_at: string;
  time_restricted: boolean;
  duration_minutes: number | null;
  duration_seconds: number | null;
}

export async function listSharedQuizzes(
  client: SupabaseClient
): Promise<SharedQuiz[]> {
  const data = unwrap(await client.rpc("list_shared_quizzes", {}));
  return (data as unknown as SharedQuiz[]) ?? [];
}

export async function cloneQuiz(
  client: SupabaseClient,
  sourceQuizId: string
): Promise<string> {
  const data = unwrap(
    await client.rpc("clone_quiz", { p_source_quiz_id: sourceQuizId })
  );
  return data as unknown as string;
}

/** The full preview tree — `AuthorQuiz`'s shape plus the authoring teacher's
 * display name (which `get_quiz_for_author` never needs, since it's always
 * the caller) and the video's channel name (which `AuthorVideo` doesn't carry,
 * since the editor's own header links out to YouTube instead of showing it).
 * `time_restricted`/`duration_minutes` are omitted because
 * `get_quiz_for_preview` doesn't return them — inheriting them from
 * `AuthorQuiz` unomitted would claim a shape this RPC doesn't produce. */
export type PreviewQuiz = Omit<AuthorQuiz, "video" | "time_restricted" | "duration_minutes"> & {
  video: AuthorQuiz["video"] & { channel_name: string | null };
  author_name: string | null;
};

/**
 * Full read (answer key + explanations included) of a quiz the caller may
 * READ: their own, or a `shared` quiz in their school. Same gate as `cloneQuiz`, so a
 * teacher can preview before committing to clone. Throws `SharingError` with
 * `not_authorized`, `quiz_not_found`, or `quiz_deleted`.
 */
export async function getQuizForPreview(
  client: SupabaseClient,
  quizId: string
): Promise<PreviewQuiz> {
  const data = unwrap(
    await client.rpc("get_quiz_for_preview", { p_quiz_id: quizId })
  );
  return data as unknown as PreviewQuiz;
}

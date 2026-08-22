/**
 * Authoring read wrapper.
 *
 * A thin, typed wrapper over the owner-checked `SECURITY DEFINER`
 * `get_quiz_for_author` RPC — the single read the teacher quiz-editor needs.
 *
 * The RPC name is cast at the call site (the `AnyClient` pattern used by
 * `lib/analytics.ts`) rather than typed against the generated `Database` type,
 * so this wrapper compiles WITHOUT `lib/supabase/types.ts` being regenerated for
 * the new RPC. It must be called with the caller's AUTHENTICATED client (the SSR
 * client in `lib/supabase/server.ts`) so `auth.uid()` resolves to the owner;
 * non-owners are rejected as `not_owner`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "@/lib/lang";

/** Question kind (single- vs multi-select). */
export type QuestionKind = "single" | "multi";

/** Whether a quiz is visible only to its author or to the whole school. */
export type QuizVisibility = "private" | "shared";

/** Transcript-fetch state of the underlying canonical video. */
export type TranscriptStatus = "pending" | "ready" | "unavailable";

/** An editable option (answer key is `is_correct`; `text` is base-language display). */
export interface AuthorOption {
  id: string;
  is_correct: boolean;
  order_index: number;
  /** Base-language option text (`null` if no translation row exists yet). */
  text: string | null;
}

/** How a question's base-language text was produced. */
export type QuestionSource = "authored" | "generated" | "translated";

/** An editable question with its base-language text and option set. */
export interface AuthorQuestion {
  id: string;
  kind: QuestionKind;
  position_seconds: number;
  order_index: number;
  /** Base-language prompt (`null` if no translation row exists yet). */
  prompt: string | null;
  /** Base-language explanation (`null` when unset). */
  explanation: string | null;
  /** `null` alongside `prompt` when no base-language translation row exists yet. */
  source: QuestionSource | null;
  options: AuthorOption[];
}

/** The canonical (shared, ownerless) video a quiz is built on. */
export interface AuthorVideo {
  id: string;
  youtube_video_id: string;
  title: string | null;
  duration_seconds: number | null;
  transcript_status: TranscriptStatus;
}

/** The full editable tree returned by `get_quiz_for_author`. */
export interface AuthorQuiz {
  quiz_id: string;
  title: string | null;
  base_language: Language;
  visibility: QuizVisibility;
  transcript_status: TranscriptStatus;
  video: AuthorVideo;
  questions: AuthorQuestion[];
  /** Non-base languages that already have at least one translation row. */
  translated_languages: Language[];
  time_restricted: boolean;
  /** Only non-null while `time_restricted`. */
  duration_minutes: number | null;
  content_updated_at: string | null;
  analytics_attempt_count: number;
}

/**
 * Raised when the authoring read RPC fails. `code` is the stable code the RPC
 * raised as its exception message (e.g. `not_owner`), matching the `ClassError`
 * convention so consumers switch on `code` alone.
 */
export class QuizAuthorError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "QuizAuthorError";
    this.code = code;
  }
}

interface RpcError {
  message: string;
  code?: string;
}

/**
 * Minimal structural view of the client's `.rpc(...)`, decoupled from the
 * generated `Database` type (regenerated at the gate).
 */
type RpcInvoker = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: RpcError | null }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

/**
 * Fetch the full editable tree of a quiz the caller owns. Must be called with the
 * signed-in teacher's authenticated client; non-owners get `not_owner`.
 */
export async function getQuizForAuthor(
  client: AnyClient,
  quizId: string
): Promise<AuthorQuiz> {
  const rpc = client.rpc.bind(client) as unknown as RpcInvoker;
  const { data, error } = await rpc("get_quiz_for_author", { p_quiz_id: quizId });
  if (error) {
    throw new QuizAuthorError(error.message);
  }
  return data as AuthorQuiz;
}

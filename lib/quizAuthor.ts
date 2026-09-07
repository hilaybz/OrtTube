/**
 * the new RPC. It must be called with the caller's AUTHENTICATED client (the SSR
 * client in `lib/supabase/server.ts`) so `auth.uid()` resolves to the owner;
 * non-owners are rejected as `not_owner`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "@/lib/lang";

export type QuestionKind = "single" | "multi";

export type QuizVisibility = "private" | "shared";

export type TranscriptStatus = "pending" | "ready" | "unavailable";

export interface AuthorOption {
  id: string;
  is_correct: boolean;
  order_index: number;
  text: string | null;
}

export type QuestionSource = "authored" | "generated" | "translated";

export interface AuthorQuestion {
  id: string;
  kind: QuestionKind;
  position_seconds: number;
  order_index: number;
  prompt: string | null;
  explanation: string | null;
  source: QuestionSource | null;
  options: AuthorOption[];
}

export interface AuthorVideo {
  id: string;
  youtube_video_id: string;
  title: string | null;
  duration_seconds: number | null;
  transcript_status: TranscriptStatus;
}

export interface AuthorQuiz {
  quiz_id: string;
  title: string | null;
  base_language: Language;
  visibility: QuizVisibility;
  transcript_status: TranscriptStatus;
  video: AuthorVideo;
  questions: AuthorQuestion[];
  translated_languages: Language[];
  time_restricted: boolean;
  duration_minutes: number | null;
  content_updated_at: string | null;
  analytics_attempt_count: number;
}

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

type RpcInvoker = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: RpcError | null }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

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

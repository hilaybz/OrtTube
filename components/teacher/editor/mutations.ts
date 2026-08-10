"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { messageForCode } from "@/lib/errors";
import type { Language } from "@/lib/lang";
import type { QuizVisibility } from "@/lib/quizAuthor";

/**
 * Browser-side authoring mutations that have NO dedicated `/api/**` route:
 * quiz-meta edits (`update_quiz`) and soft-deletes (`soft_delete_question`,
 * `soft_delete_option`). They run directly against the owner-checked
 * SECURITY DEFINER RPCs through the browser Supabase client, so `auth.uid()`
 * resolves to the signed-in teacher and RLS/ownership are enforced exactly as
 * they are for the routed mutations.
 *
 * (`upsert_question`, `generate`, and `translate` DO have routes and go through
 * `apiFetch` instead — see the editor components.)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;
type RpcInvoker = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** Thrown when a direct authoring RPC raises a stable code. `.message` is Hebrew. */
export class MutationError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(messageForCode(code));
    this.name = "MutationError";
    this.code = code;
  }
}

function invoker(): RpcInvoker {
  const client = createClient() as unknown as AnyClient;
  return client.rpc.bind(client) as unknown as RpcInvoker;
}

async function call(fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await invoker()(fn, args);
  // RPCs raise their stable code as the exception MESSAGE (see the migrations).
  if (error) throw new MutationError(error.message || "internal_error");
}

/**
 * Patch a quiz's editable meta. Omitted (null) fields are left unchanged by the
 * RPC — except `title`, where an EMPTY string means "clear it", so the quiz
 * falls back to showing the video's title. Passing null for the title reads as
 * "not provided" and leaves the existing one in place.
 */
export function updateQuizMeta(
  quizId: string,
  patch: { title?: string | null; visibility?: QuizVisibility; baseLanguage?: Language }
): Promise<void> {
  return call("update_quiz", {
    p_quiz_id: quizId,
    p_title: patch.title ?? null,
    p_visibility: patch.visibility ?? null,
    p_base_language: patch.baseLanguage ?? null,
  });
}

/** Soft-delete a question (answer history preserved). */
export function deleteQuestion(questionId: string): Promise<void> {
  return call("soft_delete_question", { p_question_id: questionId });
}

/** Soft-delete a single option (backstopped by the last-correct constraint). */
export function deleteOption(optionId: string): Promise<void> {
  return call("soft_delete_option", { p_option_id: optionId });
}

/**
 * "Most-asked-questions → topic clusters" analytic.
 *
 * Two clearly-separated steps, on purpose:
 *   1. `fetchTutorPrompts` — an owner-checked RPC read (`tutor_prompts_in_scope`)
 *      run with the CALLER'S session client, so RLS + the RPC's owner check apply.
 *      A non-owner surfaces as `AnalyticsError('not_owner')` → 403 via the shared
 *      analytics error mapping; the bad-scope rule surfaces as `invalid_args`.
 *   2. `clusterQuestions` — the AI call, which never touches the database.
 *
 * `getTopicClusters` composes the two: read prompts, then cluster them. Keeping
 * the RPC read out of the AI module (and vice-versa) means the DB access is
 * owner-gated in one place and the LLM call stays a pure text transform.
 *
 * The RPC name is cast at the call site (the un-parameterised `.rpc` pattern used
 * in `lib/analytics.ts`), so this wrapper compiles without `tutor_prompts_in_scope`
 * appearing in the generated `lib/supabase/types.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AnalyticsError } from "@/lib/analytics";
import type { Language } from "@/lib/lang";
import {
  clusterQuestions,
  type ClusterAnthropicClient,
  type TopicCluster,
} from "@/lib/ai/clusterQuestions";

/** One row from `tutor_prompts_in_scope`. */
export interface TutorPromptRow {
  prompt: string;
  /** The on-screen question at ask time, if any (null otherwise). */
  question_id: string | null;
  created_at: string;
}

/** `tutor_prompts_in_scope(quiz_id | class_id)` result. */
export interface TutorPromptsResult {
  scope: "quiz" | "class";
  prompts: TutorPromptRow[];
}

/** Envelope returned by `getTopicClusters`. */
export interface TopicClustersResult {
  scope: "quiz" | "class";
  summary: string;
  cluster_count: number;
  clusters: TopicCluster[];
}

/** Exactly one scope, mirroring `getTutorStats`. */
export type TopicScope = { quizId: string } | { classId: string };

interface RpcError {
  message: string;
  code?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

type RpcInvoker = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: RpcError | null }>;

/**
 * Fetch the tutor prompts in scope for the OWNER via the owner-checked RPC.
 * Must be called with the caller's session client (not service-role), so the
 * RPC's `auth.uid()` owner check runs. Throws `AnalyticsError` on RPC failure.
 */
export async function fetchTutorPrompts(
  client: AnyClient,
  scope: TopicScope
): Promise<TutorPromptsResult> {
  const args: Record<string, unknown> =
    "quizId" in scope
      ? { p_quiz_id: scope.quizId, p_class_id: null }
      : { p_quiz_id: null, p_class_id: scope.classId };

  const rpc = client.rpc.bind(client) as unknown as RpcInvoker;
  const { data, error } = await rpc("tutor_prompts_in_scope", args);
  if (error) throw new AnalyticsError(error.message);
  return data as TutorPromptsResult;
}

/**
 * End-to-end analytic: read the tutor prompts in scope (owner-checked), then
 * cluster them into topics in `language` (default Hebrew). Returns an empty
 * cluster list (no AI call) when there are no prompts in scope.
 *
 * `aiClient` is injectable for tests; production defaults to a fresh Anthropic
 * client inside `clusterQuestions`.
 */
export async function getTopicClusters(
  client: AnyClient,
  scope: TopicScope,
  language: Language = "he",
  aiClient?: ClusterAnthropicClient
): Promise<TopicClustersResult> {
  const { scope: resolvedScope, prompts } = await fetchTutorPrompts(client, scope);

  const promptTexts = prompts.map((p) => p.prompt);
  const { summary, clusters } = await clusterQuestions(
    promptTexts,
    language,
    aiClient
  );

  return {
    scope: resolvedScope,
    summary,
    cluster_count: clusters.length,
    clusters,
  };
}

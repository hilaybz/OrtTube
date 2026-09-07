/**
 * Trust model (identical to `lib/analytics.ts`):
 * - The RPCs check ownership via `auth.uid()`, so they MUST be called with a
 *   client carrying the signed-in teacher's session (the SSR/anon client in
 *   `lib/supabase/server.ts`) — NOT the service-role client, which has no
 *   `auth.uid()` and would always be rejected as `not_owner`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AnalyticsError } from "@/lib/analytics";

export interface RosterQuizProgress {
  quiz_id: string;
  title: string | null;
  completed: boolean;
  attempt_count: number;
  best_num_correct: number | null;
  best_num_questions: number | null;
  best_score: number | null;
}

export interface RosterMemberProgress {
  student_id: string;
  display_name: string | null;
  email: string;
  total_assigned: number;
  quizzes_completed: number;
  average_best_score: number | null;
  quizzes: RosterQuizProgress[];
}

export interface RosterProgressSummary {
  member_count: number;
  total_assigned: number;
  possible_completions: number;
  quizzes_completed_total: number;
  average_best_score: number | null;
}

export interface ClassRosterProgress {
  class_id: string;
  summary: RosterProgressSummary;
  members: RosterMemberProgress[];
}

export interface StudentAttemptProgress {
  attempt_id: string;
  attempt_no: number;
  started_at: string;
  completed_at: string | null;
  num_correct: number | null;
  num_questions: number | null;
  score: number | null;
}

export interface StudentQuizProgressItem {
  quiz_id: string;
  title: string | null;
  completed: boolean;
  attempt_count: number;
  best_score: number | null;
  attempts: StudentAttemptProgress[];
}

export interface StudentQuizProgress {
  class_id: string;
  student_id: string;
  display_name: string | null;
  email: string | null;
  quizzes: StudentQuizProgressItem[];
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

async function callRpc<T>(
  client: AnyClient,
  fn: string,
  args: Record<string, unknown>
): Promise<T> {
  const rpc = client.rpc.bind(client) as unknown as RpcInvoker;
  const { data, error } = await rpc(fn, args);
  if (error) {
    throw new AnalyticsError(error.message);
  }
  return data as T;
}

export async function getClassRosterProgress(
  client: AnyClient,
  classId: string
): Promise<ClassRosterProgress> {
  return callRpc<ClassRosterProgress>(client, "class_roster_progress", {
    p_class_id: classId,
  });
}

export async function getStudentQuizProgress(
  client: AnyClient,
  classId: string,
  studentId: string
): Promise<StudentQuizProgress> {
  return callRpc<StudentQuizProgress>(client, "student_quiz_progress", {
    p_class_id: classId,
    p_student_id: studentId,
  });
}

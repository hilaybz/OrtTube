import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listMyAttemptsForQuiz, type StudentAttemptState } from "@/lib/attempts";
import { QuizPlayer } from "@/components/student/QuizPlayer";

export default async function QuizPlayerPage({
  params,
}: {
  params: Promise<{ classId: string; quizId: string }>;
}) {
  const { classId, quizId } = await params;
  const client = (await createClient()) as unknown as SupabaseClient;

  let state: StudentAttemptState;
  try {
    state = await listMyAttemptsForQuiz(client, classId, quizId);
  } catch {
    // not a member / not assigned / signed out → nothing to play here.
    notFound();
  }

  return <QuizPlayer classId={classId} quizId={quizId} state={state} />;
}

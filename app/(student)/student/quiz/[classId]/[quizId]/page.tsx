import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listMyAttemptsForQuiz, findLatestCompletedAttempt, type StudentAttemptState } from "@/lib/attempts";
import { QuizPlayer } from "@/components/student/QuizPlayer";
import { TranscriptWarmer } from "@/components/TranscriptWarmer";

export default async function QuizPlayerPage({
  params,
}: {
  params: Promise<{ classId: string; quizId: string }>;
}) {
  const { classId, quizId } = await params;
  const client = (await createClient()) as unknown as SupabaseClient;
  const resultsHref = `/student/quiz/${classId}/${quizId}/results`;

  let state: StudentAttemptState;
  try {
    state = await listMyAttemptsForQuiz(client, classId, quizId);
  } catch {
    // Not a member / signed out / genuinely never assigned — OR the
    // allocation's window has closed (or it's a draft) between when the
    // student last had it and now, which raises the same not_assigned. A
    // closed window doesn't erase a finished attempt, so check for one before
    // giving up: if this student has a completed attempt here, send them to
    // their results instead of a dead "not available" page.
    let completed: Awaited<ReturnType<typeof findLatestCompletedAttempt>> = null;
    try {
      completed = await findLatestCompletedAttempt(client, classId, quizId);
    } catch {
      // fall through to notFound()
    }
    if (completed) {
      redirect(resultsHref);
    }
    notFound();
  }

  // A finished quiz with no attempt left has nothing to play: the player's
  // opening screen would be a thumbnail whose only control links onward to the
  // results. Skip it — the student asked for a quiz they have already finished,
  // and their score is the answer. Mid-attempt is not finished, so an
  // unfinished attempt still opens the player even with the allowance spent.
  const finishedForGood =
    state.last_completed_attempt_id != null &&
    !state.in_progress &&
    state.attempts_left != null &&
    state.attempts_left <= 0;
  if (finishedForGood) redirect(resultsHref);

  return (
    <>
      {/* Warm the transcript now so the AI tutor is ready if this student asks
          — reaching for it mid-quiz is the worst moment to start a cold fetch. */}
      <TranscriptWarmer quizId={quizId} classId={classId} />
      <QuizPlayer classId={classId} quizId={quizId} state={state} />
    </>
  );
}

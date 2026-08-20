import Link from "next/link";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  listMyAttemptsForQuiz,
  findLatestCompletedAttempt,
  getAttemptReview,
  getQuizForStudent,
  type StudentAttemptState,
  type StudentQuestion,
} from "@/lib/attempts";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { BackLink } from "@/components/ui/BackLink";
import { ReviewList, type ReviewItem } from "@/components/student/ReviewList";
import { gradeOf } from "@/components/student/grade";

/**
 * The score, presented the way a student reads a score: a grade out of 100,
 * with the raw "how many did I get right" underneath it. `gradeOf` returns null
 * only when the attempt recorded no questions, and then there is no grade to
 * claim.
 */
function ScoreHeader({ correct, total }: { correct: number; total: number }) {
  const grade = gradeOf(correct, total);
  return (
    <GlassCard className="flex flex-col items-center gap-3 text-center">
      <h1 className="text-2xl font-bold">הסיכום שלך</h1>
      {grade != null ? (
        <p className="flex flex-col items-center leading-none">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--body-subtle)]">
            ציון
          </span>
          <span className="mt-1.5 text-6xl font-bold text-[var(--heading)]">{grade}</span>
          <span className="mt-2 text-xs text-[var(--body-subtle)]">מתוך 100</span>
        </p>
      ) : (
        <span className="grid h-14 w-14 place-items-center rounded-full bg-[var(--brand-softer)]">
          <Icon name="check" size={26} label="הושלם" className="text-[var(--fg-brand)]" />
        </span>
      )}
      <p className="text-sm text-[var(--body)]">
        ענית נכון על {correct} מתוך {total} שאלות
      </p>
    </GlassCard>
  );
}

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ classId: string; quizId: string }>;
}) {
  const { classId, quizId } = await params;
  const client = (await createClient()) as unknown as SupabaseClient;
  const playerHref = `/student/quiz/${classId}/${quizId}`;

  const wrap = (children: React.ReactNode) => (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 py-6">
      <BackLink href="/student" label="הפיד שלי" />
      {children}
    </div>
  );

  // The common path: the allocation is (or was recently) live, so the full
  // delivery-context read succeeds and carries attempts_left/max_attempts for
  // the retake button and messaging.
  let state: StudentAttemptState | null = null;
  try {
    state = await listMyAttemptsForQuiz(client, classId, quizId);
  } catch {
    // Not a member / signed out / never assigned — OR the allocation's
    // window has since closed (or it's a draft), which raises the same
    // not_assigned. A closed window doesn't erase a finished attempt (Epic
    // 2A: "attempts, grades and analytics remain intact"), so fall back to a
    // direct RLS-scoped read of the student's own attempts before giving up.
    // In this fallback, attempts_left/max_attempts are unknown — retaking is
    // correctly treated as unavailable, since it genuinely isn't once the
    // allocation isn't live.
  }

  let attemptId: string | null = null;
  let lastNumCorrect: number | null = null;
  let lastNumQuestions: number | null = null;
  let canRetake = false;
  let attemptsLeftLine: string | null = null;

  if (state) {
    attemptId = state.last_completed_attempt_id;
    lastNumCorrect = state.last_num_correct;
    lastNumQuestions = state.last_num_questions;
    canRetake = state.attempts_left == null || state.attempts_left > 0;
    attemptsLeftLine = state.attempts_left != null ? `נותרו ${state.attempts_left} ניסיונות.` : null;
  } else {
    const fallback = await findLatestCompletedAttempt(client, classId, quizId);
    if (!fallback) notFound();
    attemptId = fallback.id;
    lastNumCorrect = fallback.num_correct;
    lastNumQuestions = fallback.num_questions;
  }

  if (!attemptId) {
    return wrap(
      <GlassCard className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-xl font-bold">עדיין לא סיימת את החידון</h1>
        <p className="text-[var(--body)]">סיימו ניסיון כדי לראות את הסיכום.</p>
        <Link
          href={playerHref}
          className="rounded-[var(--radius)] bg-[var(--brand)] px-5 py-2.5 font-medium text-[#06210f]"
        >
          למעבר לחידון
        </Link>
      </GlassCard>
    );
  }

  const review = await getAttemptReview(client, attemptId);
  const correct = review.num_correct ?? lastNumCorrect ?? 0;
  const total = review.num_questions ?? lastNumQuestions ?? 0;

  // Reveal gate: while a retake remains (or attempts are unlimited), only the
  // aggregate score is exposed — never per-question correctness.
  if (!review.revealed) {
    return wrap(
      <>
        <ScoreHeader correct={correct} total={total} />
        <GlassCard className="flex flex-col items-center gap-3 text-center">
          <Icon name="lock" size={22} label="נעול" className="text-[var(--body-subtle)]" />
          <p className="text-sm text-[var(--body)]">
            פירוט התשובות והנימוקים ייחשף לאחר שלא יישארו ניסיונות נוספים.
            {attemptsLeftLine && ` ${attemptsLeftLine}`}
          </p>
          {canRetake && (
            <Link
              href={playerHref}
              className="rounded-[var(--radius)] border border-[var(--glass-border)] bg-[var(--glass-bg)] px-5 py-2.5 font-medium"
            >
              ניסיון נוסף
            </Link>
          )}
        </GlassCard>
      </>
    );
  }

  // Revealed: join the answer-free read for prompt/option labels. Questions in
  // the frozen snapshot that were soft-deleted since fall back to a label.
  // Labels come from the answer-free read. If the quiz was unassigned/soft-deleted
  // since completion — or its window has closed, which now also gates this read —
  // this can throw; degrade to fallback labels rather than 500.
  let qmap = new Map<string, StudentQuestion>();
  try {
    const quiz = await getQuizForStudent(client, classId, quizId);
    qmap = new Map(quiz.questions.map((q) => [q.id, q]));
  } catch {
    // fall through with an empty map
  }
  const items: ReviewItem[] = (review.questions ?? []).map((rq) => {
    const q = qmap.get(rq.question_id);
    return {
      prompt: q?.prompt ?? "שאלה שהוסרה מהחידון",
      explanation: rq.explanation,
      was_correct: rq.was_correct,
      options: (q?.options ?? []).map((o) => ({
        id: o.id,
        text: o.text,
        correct: rq.correct_option_ids.includes(o.id),
        selected: rq.selected_option_ids.includes(o.id),
      })),
    };
  });

  return wrap(
    <>
      <ScoreHeader correct={correct} total={total} />
      <ReviewList items={items} />
    </>
  );
}

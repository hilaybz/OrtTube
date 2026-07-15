import Link from "next/link";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  listMyAttemptsForQuiz,
  getAttemptReview,
  getQuizForStudent,
  type StudentAttemptState,
  type StudentQuestion,
} from "@/lib/attempts";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { ReviewList, type ReviewItem } from "@/components/student/ReviewList";

function ScoreHeader({ correct, total }: { correct: number; total: number }) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  return (
    <GlassCard className="flex flex-col items-center gap-2 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full bg-[var(--brand-softer)]">
        <Icon name="check" size={28} label="ציון" className="text-[var(--fg-brand)]" />
      </span>
      <h1 className="text-2xl font-bold">הסיכום שלך</h1>
      <p className="text-lg text-[var(--body)]">
        ענית נכון על{" "}
        <b className="text-[var(--heading)]">
          {correct}/{total}
        </b>{" "}
        שאלות ({pct}%)
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

  let state: StudentAttemptState;
  try {
    state = await listMyAttemptsForQuiz(client, classId, quizId);
  } catch {
    notFound();
  }

  const wrap = (children: React.ReactNode) => (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 py-6">{children}</div>
  );

  if (!state.last_completed_attempt_id) {
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

  const review = await getAttemptReview(client, state.last_completed_attempt_id);
  const correct = review.num_correct ?? 0;
  const total = review.num_questions ?? 0;
  const canRetake = state.attempts_left == null || state.attempts_left > 0;

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
            {state.attempts_left != null && ` נותרו ${state.attempts_left} ניסיונות.`}
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
  // since completion this can throw — degrade to fallback labels rather than 500.
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

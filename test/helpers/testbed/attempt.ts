/**
 * Attempt handle: a student's in-flight attempt at a quiz in a class. Wraps the
 * `start_or_resume_attempt` result and drives `submit_answer` / `complete_attempt`
 * / `get_attempt_review` as the owning student (or, via `answerAs`, as an intruder
 * to exercise the `not_your_attempt` guard).
 */
import {
  submitAnswer,
  completeAttempt,
  getAttemptReview,
  type StartAttemptResult,
  type AttemptSummary,
  type AttemptReview,
} from "@/lib/attempts";
import type { Actor } from "./internal";
import type { AuthoredQuestion, Quiz } from "./quiz";
import type { Classroom } from "./classroom";
import type { Student } from "./student";

export class Attempt {
  constructor(
    private readonly result: StartAttemptResult,
    readonly student: Student,
    readonly quiz: Quiz,
    readonly classroom: Classroom
  ) {}

  get id(): string {
    return this.result.attempt_id;
  }
  get attemptNo(): number {
    return this.result.attempt_no;
  }
  /** True → an existing incomplete attempt was resumed. */
  get resumed(): boolean {
    return this.result.resumed;
  }
  /** Ids of the questions already answered when this attempt was (re)started. */
  get answeredQuestionIds(): string[] {
    return this.result.answered_question_ids;
  }

  /** Submit an explicit option-id selection for a question. */
  answer(q: AuthoredQuestion, optionIds: string[]): Promise<unknown> {
    return submitAnswer(this.student.client, this.id, q.id, optionIds);
  }

  /** Submit the correct answer (single pick or exact multi set) for a question. */
  answerCorrectly(q: AuthoredQuestion): Promise<unknown> {
    return this.answer(q, q.correctIds);
  }

  /** Answer every DSL-authored question of the quiz correctly. */
  async answerAllCorrectly(): Promise<void> {
    for (const q of this.quiz.questions) {
      await this.answerCorrectly(q);
    }
  }

  /** Submit AS another actor — used to exercise the `not_your_attempt` guard. */
  answerAs(
    actor: Actor,
    q: AuthoredQuestion,
    optionIds: string[]
  ): Promise<unknown> {
    return submitAnswer(actor.client, this.id, q.id, optionIds);
  }

  /** Finalize the attempt and return its aggregate score summary. */
  complete(): Promise<AttemptSummary> {
    return completeAttempt(this.student.client, this.id);
  }

  /** The reveal-gated review for this attempt (per-question detail only if revealed). */
  review(): Promise<AttemptReview> {
    return getAttemptReview(this.student.client, this.id);
  }
}

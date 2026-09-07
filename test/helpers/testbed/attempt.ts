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
  get resumed(): boolean {
    return this.result.resumed;
  }
  get answeredQuestionIds(): string[] {
    return this.result.answered_question_ids;
  }

  answer(q: AuthoredQuestion, optionIds: string[]): Promise<unknown> {
    return submitAnswer(this.student.client, this.id, q.id, optionIds);
  }

  answerCorrectly(q: AuthoredQuestion): Promise<unknown> {
    return this.answer(q, q.correctIds);
  }

  async answerAllCorrectly(): Promise<void> {
    for (const q of this.quiz.questions) {
      await this.answerCorrectly(q);
    }
  }

  answerAs(
    actor: Actor,
    q: AuthoredQuestion,
    optionIds: string[]
  ): Promise<unknown> {
    return submitAnswer(actor.client, this.id, q.id, optionIds);
  }

  complete(): Promise<AttemptSummary> {
    return completeAttempt(this.student.client, this.id);
  }

  review(): Promise<AttemptReview> {
    return getAttemptReview(this.student.client, this.id);
  }
}

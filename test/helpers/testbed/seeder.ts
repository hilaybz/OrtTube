/**
 * Seeder: out-of-band fixture fabrication.
 *
 * Fabricates behavioural rows that have NO clean domain-action equivalent (e.g. a
 * logged tutor question the server writes via the service role). Kept separate
 * from actor methods so a test's narrative stays about who-does-what. Exposed to
 * tests as `testbed.seed`.
 */
import { getServiceClient } from "../db";
import type { Student } from "./student";
import type { Classroom } from "./classroom";
import type { Quiz, AuthoredQuestion } from "./quiz";
import type { Attempt } from "./attempt";

export class Seeder {
  /** Log a tutor interaction row via the service client (server-side write path). */
  async logTutorQuestion(opts: {
    student: Student | null;
    classroom: Classroom;
    quiz: Quiz;
    positionSeconds?: number;
    prompt: string;
    aiResponse: string;
    onQuestion?: AuthoredQuestion | null;
    duringAttempt?: Attempt | null;
  }): Promise<void> {
    const { error } = await getServiceClient()
      .from("tutor_questions")
      .insert({
        student_id: opts.student?.id ?? null,
        class_id: opts.classroom.id,
        quiz_id: opts.quiz.id,
        video_id: opts.quiz.videoId!,
        question_id: opts.onQuestion?.id ?? null,
        attempt_id: opts.duringAttempt?.id ?? null,
        position_seconds: opts.positionSeconds ?? null,
        prompt: opts.prompt,
        ai_response: opts.aiResponse,
      });
    if (error) throw new Error(`logTutorQuestion failed: ${error.message}`);
  }
}

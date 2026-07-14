/**
 * Student actor: reads the assigned feed, opens the answer-free quiz view, starts
 * attempts, and asks for the per-class tutor context — each as this student's
 * authenticated (RLS-subject) client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "@/lib/lang";
import {
  getQuizForStudent,
  startOrResumeAttempt,
  type StudentQuiz,
} from "@/lib/attempts";
import { listAssignedForStudent, type StudentFeedClass, type TutorMode } from "@/lib/classes";
import { getPool } from "../db";
import type { Actor } from "./internal";
import type { Quiz } from "./quiz";
import type { Classroom } from "./classroom";
import { Attempt } from "./attempt";

/** Per-class tutor context returned by `get_tutor_mode`. */
export interface TutorContext {
  tutor_mode: TutorMode;
  class_language: Language;
  base_language: Language;
  preferred_language: Language | null;
  video_id: string;
  youtube_video_id: string;
}

/** Error carrying a stable `get_tutor_mode` code (`not_member`, `not_assigned`). */
export class TutorError extends Error {
  readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = "TutorError";
    this.code = message;
  }
}

export class Student implements Actor {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly email: string,
    readonly password: string,
    /** This student's authenticated (RLS-subject) client. */
    readonly client: SupabaseClient
  ) {}

  /** This student's class-tabbed feed of assigned, non-deleted quizzes. */
  assignedFeed(): Promise<StudentFeedClass[]> {
    return listAssignedForStudent(this.client);
  }

  /** Set the student's `preferred_language` (drives language resolution). */
  async setPreferredLanguage(language: Language): Promise<void> {
    await getPool().query(
      "UPDATE public.profiles SET preferred_language=$1 WHERE id=$2",
      [language, this.id]
    );
  }

  /** The answer-free quiz read for this student in a class (`get_quiz_for_student`). */
  viewQuiz(quiz: Quiz, opts: { in: Classroom }): Promise<StudentQuiz> {
    return getQuizForStudent(this.client, opts.in.id, quiz.id);
  }

  /** Start a new attempt (or resume the incomplete one) for a quiz in a class. */
  async startAttempt(quiz: Quiz, opts: { in: Classroom }): Promise<Attempt> {
    const result = await startOrResumeAttempt(this.client, opts.in.id, quiz.id);
    return new Attempt(result, this, quiz, opts.in);
  }

  /** The per-class tutor context (`get_tutor_mode`). Throws `not_member`/`not_assigned`. */
  async tutorContext(quiz: Quiz, opts: { in: Classroom }): Promise<TutorContext> {
    const { data, error } = await this.client.rpc("get_tutor_mode", {
      p_class_id: opts.in.id,
      p_quiz_id: quiz.id,
    });
    if (error) throw new TutorError(error.message);
    return data as unknown as TutorContext;
  }

  /** Whether the student can directly SELECT the class/quiz assignment row (RLS probe). */
  async canSeeAssignment(quiz: Quiz, opts: { in: Classroom }): Promise<boolean> {
    const { data } = await this.client
      .from("class_quizzes")
      .select("tutor_mode")
      .eq("class_id", opts.in.id)
      .eq("quiz_id", quiz.id);
    return (data ?? []).length > 0;
  }
}

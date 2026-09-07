import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "@/lib/lang";
import {
  getQuizForStudent,
  startOrResumeAttempt,
  listMyAttemptsForQuiz,
  type StudentQuiz,
  type StudentAttemptState,
} from "@/lib/attempts";
import { listStudentFeed, type StudentFeedItem, type TutorMode } from "@/lib/classes";
import { getPool } from "../db";
import type { Actor } from "./internal";
import type { Quiz } from "./quiz";
import type { Classroom } from "./classroom";
import { Attempt } from "./attempt";

export interface TutorContext {
  tutor_mode: TutorMode;
  class_language: Language;
  base_language: Language;
  preferred_language: Language | null;
  video_id: string;
  youtube_video_id: string;
}

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
    readonly client: SupabaseClient
  ) {}

  feed(): Promise<StudentFeedItem[]> {
    return listStudentFeed(this.client);
  }

  async setPreferredLanguage(language: Language): Promise<void> {
    await getPool().query(
      "UPDATE public.profiles SET preferred_language=$1 WHERE id=$2",
      [language, this.id]
    );
  }

  viewQuiz(quiz: Quiz, opts: { in: Classroom }): Promise<StudentQuiz> {
    return getQuizForStudent(this.client, opts.in.id, quiz.id);
  }

  async startAttempt(quiz: Quiz, opts: { in: Classroom }): Promise<Attempt> {
    const result = await startOrResumeAttempt(this.client, opts.in.id, quiz.id);
    return new Attempt(result, this, quiz, opts.in);
  }

  attemptState(quiz: Quiz, opts: { in: Classroom }): Promise<StudentAttemptState> {
    return listMyAttemptsForQuiz(this.client, opts.in.id, quiz.id);
  }

  async tutorContext(quiz: Quiz, opts: { in: Classroom }): Promise<TutorContext> {
    const { data, error } = await this.client.rpc("get_tutor_mode", {
      p_class_id: opts.in.id,
      p_quiz_id: quiz.id,
    });
    if (error) throw new TutorError(error.message);
    return data as unknown as TutorContext;
  }

  async canSeeAssignment(quiz: Quiz, opts: { in: Classroom }): Promise<boolean> {
    const { data } = await this.client
      .from("class_quizzes")
      .select("tutor_mode")
      .eq("class_id", opts.in.id)
      .eq("quiz_id", quiz.id);
    return (data ?? []).length > 0;
  }
}

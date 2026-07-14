/**
 * Teacher actor: authors quizzes, opens classes, manages the roster, assigns
 * quizzes, and reads owner-checked analytics — each method calls the real
 * `@/lib/*` wrapper / RPC as this teacher's authenticated (RLS-subject) client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "@/lib/lang";
import {
  createClass,
  listMyClasses,
  addStudentToClass,
  assignQuizToClass,
  unassignQuiz as unassignQuizFromClass,
  type ClassRow,
  type AddStudentResult,
  type AssignmentResult,
} from "@/lib/classes";
import {
  upsertQuestion,
  softDeleteQuestion,
  softDeleteOption,
  updateQuiz,
  listMyQuizzes,
  QuizError,
  type MyQuiz,
} from "@/lib/quiz";
import {
  getQuizStats,
  getQuestionStats,
  getClassStats,
  getTutorStats,
  type QuizStats,
  type QuestionStatsResult,
  type ClassStats,
  type TutorStats,
} from "@/lib/analytics";
import { getPool } from "../db";
import type { Actor } from "./internal";
import type { QuestionFixture } from "./builders";
import { Classroom, type AssignOptions } from "./classroom";
import { Quiz, AuthoredQuestion, QuizOption, type SharedQuizRow } from "./quiz";

export class Teacher implements Actor {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly email: string,
    readonly password: string,
    /** This teacher's authenticated (RLS-subject) client. */
    readonly client: SupabaseClient
  ) {}

  /** Open (create) a class owned by this teacher, in this teacher's school. */
  async openClass(
    opts: { name?: string; language?: Language } = {}
  ): Promise<Classroom> {
    const row = await createClass(this.client, {
      name: opts.name ?? `${this.name}'s Class`,
      language: opts.language,
    });
    return new Classroom(row, this);
  }

  /** This teacher's own classes. */
  myClasses(): Promise<ClassRow[]> {
    return listMyClasses(this.client);
  }

  /**
   * Author a quiz on a video (real `create_quiz_for_video` RPC), optionally with
   * a full question set (structural rows + answer key + base/extra-language text).
   */
  async authorQuiz(
    opts: {
      onVideo?: string;
      baseLanguage?: Language;
      title?: string;
      visibility?: "private" | "shared";
      questions?: QuestionFixture[];
    } = {}
  ): Promise<Quiz> {
    const baseLanguage = opts.baseLanguage ?? "he";
    const { data, error } = await this.client.rpc("create_quiz_for_video", {
      p_youtube_id: opts.onVideo ?? `yt-${Math.random().toString(36).slice(2)}`,
      p_video_title: "A Video",
      p_duration_seconds: 600,
      p_base_language: baseLanguage,
      p_quiz_title: opts.title ?? "Quiz",
    });
    if (error) throw new Error(`create_quiz_for_video failed: ${error.message}`);
    const created = data as {
      quiz_id: string;
      video_id: string;
      youtube_video_id: string;
    };
    const quiz = new Quiz(
      created.quiz_id,
      baseLanguage,
      this,
      created.video_id,
      created.youtube_video_id
    );

    if (opts.visibility === "shared") await this.setVisibility(quiz, "shared");

    for (const fixture of opts.questions ?? []) {
      await this.addQuestion(quiz, fixture);
    }
    return quiz;
  }

  /**
   * Author one question on `quiz` (real `upsert_question` RPC + any extra-language
   * rows). Returns a handle exposing the created option ids + answer key. Throws
   * the RPC's stable code (e.g. `not_owner`, `single_needs_exactly_one_correct`)
   * on rejection, so guard tests can `expect(...).rejects`.
   */
  async addQuestion(
    quiz: Quiz,
    fixture: QuestionFixture
  ): Promise<AuthoredQuestion> {
    const questionId = await upsertQuestion(this.client, {
      quizId: quiz.id,
      kind: fixture.kind,
      positionSeconds: fixture.positionSeconds,
      orderIndex: fixture.orderIndex,
      basePrompt: fixture.basePrompt,
      baseExplanation: fixture.baseExplanation ?? null,
      options: fixture.options,
      source: "authored",
    });

    const options = await this.readOptions(questionId, quiz.baseLanguage);
    await this.writeExtraLanguages(questionId, options, fixture);

    const authored = new AuthoredQuestion(questionId, options, quiz);
    quiz.questions.push(authored);
    return authored;
  }

  /** Soft-delete a question (owner-scoped `soft_delete_question` RPC). */
  removeQuestion(q: AuthoredQuestion): Promise<void> {
    return softDeleteQuestion(this.client, q.id);
  }

  /** Soft-delete an option (owner-scoped). Throws `cannot_remove_last_correct`. */
  removeOption(option: QuizOption | string): Promise<void> {
    const id = typeof option === "string" ? option : option.id;
    return softDeleteOption(this.client, id);
  }

  /** Set a quiz's visibility (owner-scoped `update_quiz` RPC). */
  setVisibility(quiz: Quiz, visibility: "private" | "shared"): Promise<void> {
    return updateQuiz(this.client, quiz.id, { visibility });
  }

  /** This teacher's own-quizzes library (incl. unassigned). */
  myQuizzes(): Promise<MyQuiz[]> {
    return listMyQuizzes(this.client);
  }

  /** The same-school shared-quiz catalog visible to this teacher. */
  async sharedQuizzes(): Promise<SharedQuizRow[]> {
    const { data, error } = await this.client.rpc("list_shared_quizzes", {});
    if (error) throw new QuizError(error.message);
    return (data as unknown as SharedQuizRow[]) ?? [];
  }

  /**
   * Deep-clone a quiz the teacher may read into a new private copy (real
   * `clone_quiz` RPC). Accepts a `Quiz` handle or a raw id (for the missing-quiz
   * guard). Throws the RPC's stable code (`not_authorized`, `quiz_not_found`,
   * `quiz_deleted`) on rejection.
   */
  async clone(source: Quiz | string): Promise<Quiz> {
    const sourceId = typeof source === "string" ? source : source.id;
    const { data, error } = await this.client.rpc("clone_quiz", {
      p_source_quiz_id: sourceId,
    });
    if (error) throw new QuizError(error.message);
    const newId = data as unknown as string;
    const row = await getPool().query<{ base_language: Language; video_id: string }>(
      "SELECT base_language, video_id FROM public.quizzes WHERE id=$1",
      [newId]
    );
    return new Quiz(newId, row.rows[0].base_language, this, row.rows[0].video_id);
  }

  // ── Analytics (owner-checked compute-on-read) ───────────────────────────────

  /** Quiz-level completion/attempt/score summary (must own the quiz). */
  quizStats(quiz: Quiz): Promise<QuizStats> {
    return getQuizStats(this.client, quiz.id);
  }

  /** Per-question correct% + distractor distribution (must own the quiz). */
  questionStats(quiz: Quiz): Promise<QuestionStatsResult> {
    return getQuestionStats(this.client, quiz.id);
  }

  /** Per-assigned-quiz class stats (must own the class). */
  classStats(classroom: Classroom): Promise<ClassStats> {
    return getClassStats(this.client, classroom.id);
  }

  /** Tutor-interaction stats for a quiz OR a class (owner-checked for the scope). */
  tutorStats(scope: { quiz: Quiz } | { class: Classroom }): Promise<TutorStats> {
    return "quiz" in scope
      ? getTutorStats(this.client, { quizId: scope.quiz.id })
      : getTutorStats(this.client, { classId: scope.class.id });
  }

  /**
   * Attempt to add a student by email AS THIS teacher. Named `try…` because it is
   * the method used to exercise the owner/same-school guards — a non-owner call
   * rejects with `not_owner`, a stranger with `cross_school`, etc.
   */
  tryEnrollByEmail(
    classroom: Classroom,
    email: string
  ): Promise<AddStudentResult> {
    return addStudentToClass(this.client, classroom.id, email);
  }

  /** Assign a quiz to a class with per-class tutor mode + attempt cap. */
  assignQuiz(quiz: Quiz, opts: AssignOptions): Promise<AssignmentResult> {
    return assignQuizToClass(
      this.client,
      {
        classId: opts.to.id,
        quizId: quiz.id,
        tutorMode: opts.tutor,
        maxAttempts: opts.maxAttempts,
      },
      {
        awaitTranslation: opts.awaitTranslation ?? false,
        ensureTranslation: opts.ensureTranslation,
      }
    );
  }

  /** Remove a quiz assignment from a class. */
  unassignQuiz(quiz: Quiz, opts: { from: Classroom }): Promise<void> {
    return unassignQuizFromClass(this.client, opts.from.id, quiz.id);
  }

  // ── internals ───────────────────────────────────────────────────────────────

  /** Read the live options of a just-authored question, in display order. */
  private async readOptions(
    questionId: string,
    baseLanguage: Language
  ): Promise<QuizOption[]> {
    const res = await getPool().query<{
      id: string;
      order_index: number;
      is_correct: boolean;
      base_text: string | null;
    }>(
      `SELECT qo.id, qo.order_index, qo.is_correct, ot.text AS base_text
         FROM public.question_options qo
         LEFT JOIN public.option_translations ot
           ON ot.option_id = qo.id AND ot.language = $2
        WHERE qo.question_id = $1 AND qo.deleted_at IS NULL
        ORDER BY qo.order_index`,
      [questionId, baseLanguage]
    );
    return res.rows.map(
      (r) => new QuizOption(r.id, r.order_index, r.is_correct, r.base_text ?? "")
    );
  }

  /** Write any extra-language question/option translations for a fixture. */
  private async writeExtraLanguages(
    questionId: string,
    options: QuizOption[],
    fixture: QuestionFixture
  ): Promise<void> {
    const pool = getPool();
    for (const [lang, prompt] of Object.entries(fixture.promptLangs ?? {})) {
      await pool.query(
        `INSERT INTO public.question_translations (question_id, language, prompt, source)
         VALUES ($1,$2,$3,'translated')`,
        [questionId, lang, prompt]
      );
    }
    for (const option of options) {
      const langs = fixture.optionLangs?.[option.baseText];
      if (!langs) continue;
      for (const [lang, text] of Object.entries(langs)) {
        await pool.query(
          `INSERT INTO public.option_translations (option_id, language, text)
           VALUES ($1,$2,$3)`,
          [option.id, lang, text]
        );
      }
    }
  }
}

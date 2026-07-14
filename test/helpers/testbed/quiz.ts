/**
 * Quiz handles: the answer key made addressable. `QuizOption`/`AuthoredQuestion`
 * expose the created option ids + answer key so tests can submit correct / subset
 * / superset / distractor selections without raw SQL; `Quiz` carries its owning
 * teacher so owner-scoped RPCs run as them.
 */
import type { Language } from "@/lib/lang";
import { getPool } from "../db";
import type { Teacher } from "./teacher";

/** One option of an authored question, with its identity + answer-key bit. */
export class QuizOption {
  constructor(
    readonly id: string,
    readonly orderIndex: number,
    readonly isCorrect: boolean,
    readonly baseText: string
  ) {}
}

/**
 * A question authored through the DSL. Exposes the answer key by id so tests can
 * submit correct / subset / superset / distractor selections without raw SQL.
 */
export class AuthoredQuestion {
  constructor(
    readonly id: string,
    readonly options: QuizOption[],
    private readonly quiz: Quiz
  ) {}

  /** The correct option ids (one for single, ≥1 for multi). */
  get correctIds(): string[] {
    return this.options.filter((o) => o.isCorrect).map((o) => o.id);
  }
  /** Every option id, in order. */
  get optionIds(): string[] {
    return this.options.map((o) => o.id);
  }
  /** The wrong-answer option ids. */
  get distractorIds(): string[] {
    return this.options.filter((o) => !o.isCorrect).map((o) => o.id);
  }
  /** The first correct option id (the single-choice answer). */
  get firstCorrect(): string {
    return this.correctIds[0];
  }
  /** Find an option by its base-language text. */
  optionByText(text: string): QuizOption {
    const found = this.options.find((o) => o.baseText === text);
    if (!found) throw new Error(`no option with base text "${text}"`);
    return found;
  }

  /** Soft-delete this question (owner-scoped `soft_delete_question` RPC). */
  softDelete(): Promise<void> {
    return this.quiz.owner.removeQuestion(this);
  }

  /**
   * Move the single-correct answer key to `optionId` in ONE transaction, so the
   * deferred single-correct constraint validates only the final (valid) state.
   * Models a teacher editing the answer key after answers were recorded.
   */
  async flipCorrectTo(optionId: string): Promise<void> {
    const conn = await getPool().connect();
    try {
      await conn.query("BEGIN");
      for (const id of this.correctIds) {
        await conn.query(
          "UPDATE public.question_options SET is_correct=false WHERE id=$1",
          [id]
        );
      }
      await conn.query(
        "UPDATE public.question_options SET is_correct=true WHERE id=$1",
        [optionId]
      );
      await conn.query("COMMIT");
    } catch (e) {
      await conn.query("ROLLBACK");
      throw e;
    } finally {
      conn.release();
    }
  }
}

/** Row returned by `list_shared_quizzes`. */
export interface SharedQuizRow {
  quiz_id: string;
  title: string | null;
  base_language: Language;
  visibility: "private" | "shared";
  video_id: string;
  youtube_video_id: string;
  is_own: boolean;
}

/** A quiz authored by a teacher. Carries its owner so owner-scoped RPCs run as them. */
export class Quiz {
  /** Questions authored through the DSL, in creation order. */
  readonly questions: AuthoredQuestion[] = [];

  constructor(
    readonly id: string,
    readonly baseLanguage: Language,
    readonly owner: Teacher,
    readonly videoId?: string,
    readonly youtubeId?: string
  ) {}

  /** Soft-delete the quiz (owner-scoped `soft_delete_quiz` RPC). */
  async softDelete(): Promise<void> {
    const { error } = await this.owner.client.rpc("soft_delete_quiz", {
      p_quiz_id: this.id,
    });
    if (error) throw new Error(`soft_delete_quiz failed: ${error.message}`);
  }

  /** Publish this quiz to the same-school shared catalog (owner-only). */
  makeShared(): Promise<void> {
    return this.owner.setVisibility(this, "shared");
  }

  /** Return this quiz to private (owner-only). */
  makePrivate(): Promise<void> {
    return this.owner.setVisibility(this, "private");
  }
}

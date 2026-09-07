/**
 * Quiz handles: the answer key made addressable. `QuizOption`/`AuthoredQuestion`
 * expose the created option ids + answer key so tests can submit correct / subset
 * / superset / distractor selections without raw SQL; `Quiz` carries its owning
 * teacher so owner-scoped RPCs run as them.
 */
import type { Language } from "@/lib/lang";
import { getPool } from "../db";
import type { Teacher } from "./teacher";

export class QuizOption {
  constructor(
    readonly id: string,
    readonly orderIndex: number,
    readonly isCorrect: boolean,
    readonly baseText: string
  ) {}
}

export class AuthoredQuestion {
  constructor(
    readonly id: string,
    readonly options: QuizOption[],
    readonly quiz: Quiz
  ) {}

  get correctIds(): string[] {
    return this.options.filter((o) => o.isCorrect).map((o) => o.id);
  }
  get optionIds(): string[] {
    return this.options.map((o) => o.id);
  }
  get distractorIds(): string[] {
    return this.options.filter((o) => !o.isCorrect).map((o) => o.id);
  }
  get firstCorrect(): string {
    return this.correctIds[0];
  }
  optionByText(text: string): QuizOption {
    const found = this.options.find((o) => o.baseText === text);
    if (!found) throw new Error(`no option with base text "${text}"`);
    return found;
  }

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

export interface SharedQuizRow {
  quiz_id: string;
  title: string | null;
  base_language: Language;
  visibility: "private" | "shared";
  video_id: string;
  youtube_video_id: string;
  is_own: boolean;
  time_restricted: boolean;
  duration_minutes: number | null;
  duration_seconds: number | null;
}

export class Quiz {
  readonly questions: AuthoredQuestion[] = [];

  constructor(
    readonly id: string,
    readonly baseLanguage: Language,
    readonly owner: Teacher,
    readonly videoId?: string,
    readonly youtubeId?: string
  ) {}

  async softDelete(): Promise<void> {
    const { error } = await this.owner.client.rpc("soft_delete_quiz", {
      p_quiz_id: this.id,
    });
    if (error) throw new Error(`soft_delete_quiz failed: ${error.message}`);
  }

  makeShared(): Promise<void> {
    return this.owner.setVisibility(this, "shared");
  }

  makePrivate(): Promise<void> {
    return this.owner.setVisibility(this, "private");
  }

  rename(title: string): Promise<void> {
    return this.owner.setTitle(this, title);
  }
}

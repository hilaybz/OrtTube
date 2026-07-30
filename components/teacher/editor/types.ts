import type { TranscriptStatus } from "@/lib/quizAuthor";

/**
 * The client-visible shape of the `POST /api/quizzes` response `quiz` object.
 *
 * Mirrors `CreatedQuiz` in `lib/quiz.ts`, redeclared here so the editor's client
 * components don't import `lib/quiz.ts` (which pulls the server-side Anthropic
 * SDK into the browser bundle).
 */
export interface CreatedQuiz {
  quiz_id: string;
  transcript_status: TranscriptStatus;
}

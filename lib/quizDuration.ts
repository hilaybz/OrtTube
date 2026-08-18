/**
 * Quiz duration — shared, dependency-free leaf module (same rationale as
 * `lib/allocationState.ts`: it must be safely importable from client
 * components without dragging in server-only code via `@/lib/quiz` or
 * `@/lib/classes`'s value exports).
 *
 * A quiz is either `time_restricted` (the teacher stated an exact minute
 * count) or not (the UI estimates one from the video's length). The estimate
 * is deliberately never stored — it's cheap to recompute and this way it can
 * never drift from the video it's derived from.
 */

/**
 * Round a video's length up to the next 5-minute increment. `null` in,
 * `null` out — `videos.duration_seconds` is nullable in practice (the
 * YouTube watch-page scrape that populates it can fail; see
 * `lib/youtube.ts`), and callers must tolerate that rather than showing a
 * bogus estimate.
 */
export function estimateQuizMinutes(durationSeconds: number | null): number | null {
  if (durationSeconds == null || durationSeconds <= 0) return null;
  return Math.ceil(durationSeconds / 300) * 5;
}

/** The minute count to show for a quiz, and whether it's an estimate. */
export interface QuizDuration {
  minutes: number;
  /** `true` when derived from video length (no `~`-free stored number). */
  estimated: boolean;
}

/**
 * The duration to render for a quiz, or `null` when nothing can be shown
 * (unrestricted, and the video's length isn't known yet). Restricted always
 * wins when both `duration_minutes` and `duration_seconds` are present —
 * the teacher's stated cap is the number that matters, not the video length.
 */
export function quizDurationMinutes(quiz: {
  time_restricted: boolean;
  duration_minutes: number | null;
  duration_seconds: number | null;
}): QuizDuration | null {
  if (quiz.time_restricted) {
    return quiz.duration_minutes != null
      ? { minutes: quiz.duration_minutes, estimated: false }
      : null;
  }
  const est = estimateQuizMinutes(quiz.duration_seconds);
  return est != null ? { minutes: est, estimated: true } : null;
}

/** `"~12 דקות"` or `"12 דקות"` — the plain-text form for contexts (like a
 * form's read-only preview line) that don't need the number split out for
 * `tabular-nums` styling. Card renderers should use `quizDurationMinutes`
 * directly so the digits can be wrapped separately. */
export function formatQuizDuration(quiz: {
  time_restricted: boolean;
  duration_minutes: number | null;
  duration_seconds: number | null;
}): string | null {
  const d = quizDurationMinutes(quiz);
  if (!d) return null;
  return `${d.estimated ? "~" : ""}${d.minutes} דקות`;
}

/**
 * Quiz duration — shared, dependency-free leaf module (same rationale as
 * `lib/allocationState.ts`: it must be safely importable from client
 * components without dragging in server-only code via `@/lib/quiz` or
 * `@/lib/classes`'s value exports).
 */

export function estimateQuizMinutes(durationSeconds: number | null): number | null {
  if (durationSeconds == null || durationSeconds <= 0) return null;
  return Math.ceil(durationSeconds / 300) * 5;
}

export interface QuizDuration {
  minutes: number;
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

export function formatQuizDuration(quiz: {
  time_restricted: boolean;
  duration_minutes: number | null;
  duration_seconds: number | null;
}): string | null {
  const d = quizDurationMinutes(quiz);
  if (!d) return null;
  return `${d.estimated ? "~" : ""}${d.minutes} דקות`;
}

/**
 * Rounded UP to the next whole minute: a 12:01 video is "13 דקות", not "12".
 * Seconds are noise at this scale, and rounding down would understate a length
 * a teacher is judging a lesson against.
 */
export function formatVideoLength(totalSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(totalSeconds / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return minutePart(rest);

  // "שעתיים" is the dual and Hebrew all but requires it — "2 שעות" reads wrong.
  // Minutes get no dual: "2 דקות" is idiomatic where "שתי דקות" sounds literary,
  // and it matches `formatQuizDuration` above, which already spells minutes with
  // a numeral.
  const hourPart = hours === 1 ? "שעה" : hours === 2 ? "שעתיים" : `${hours} שעות`;
  if (rest === 0) return hourPart;
  // The conjunction takes a hyphen before a numeral ("ו-3 דקות") and attaches
  // straight to a word ("ודקה"). "שעה ו-דקה" is the giveaway of a formatter
  // that only ever saw the numeric case.
  const tail = minutePart(rest);
  return `${hourPart} ${/^\d/.test(tail) ? "ו-" : "ו"}${tail}`;
}

function minutePart(n: number): string {
  return n === 1 ? "דקה" : `${n} דקות`;
}

export function durationChipText(quiz: {
  time_restricted: boolean;
  duration_minutes: number | null;
  duration_seconds: number | null;
}): string | null {
  const d = quizDurationMinutes(quiz);
  return d ? `${d.estimated ? "~" : ""}${d.minutes} דק׳` : null;
}

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

/**
 * A video's own length, in words — `"13 דקות"`, `"שעה ו-3 דקות"`.
 *
 * Distinct from everything above, which is about how long a quiz TAKES. This is
 * how long the video RUNS, and it is shown as a sentence rather than as `10:00`
 * because a bare `mm:ss` beside the words "אורך הסרטון" reads as ambiguous —
 * ten minutes or ten hours — and `1:02:34` is worse.
 *
 * Rounded UP to the next whole minute: a 12:01 video is "13 דקות", not "12".
 * Seconds are noise at this scale, and rounding down would understate a length
 * a teacher is judging a lesson against.
 *
 * `formatTime` in `components/teacher/editor/format.ts` is deliberately NOT
 * changed to do this. Its other callers seed a text input that `parseTime` reads
 * back, and the question-checkpoint chips show a POSITION in the video, where
 * `mm:ss` is the correct and expected form.
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

/**
 * The same length in the words a card chip has room for — `"~12 דק׳"`. `null`
 * when nothing is known, so a caller can skip the chip rather than render an
 * empty one.
 */
export function durationChipText(quiz: {
  time_restricted: boolean;
  duration_minutes: number | null;
  duration_seconds: number | null;
}): string | null {
  const d = quizDurationMinutes(quiz);
  return d ? `${d.estimated ? "~" : ""}${d.minutes} דק׳` : null;
}

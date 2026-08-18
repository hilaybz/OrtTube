/**
 * Subject constants for classes.
 *
 * A class is a group of students learning one subject together, so
 * `classes.subject` is required (`NOT NULL`) and drawn from this controlled
 * vocabulary — the same shape as `lib/lang.ts` / `classes.language`.
 *
 * These values are stable English keys, mirroring the CHECK constraint in
 * `supabase/migrations/140_class_subject.sql`; the two lists must stay in step,
 * so adding a subject is a migration plus an edit here plus a Hebrew label in
 * `components/teacher/classes/labels.ts`. Display names are never stored — a
 * key means the same subject regardless of the language it's shown in, which is
 * what lets classes be grouped by subject exactly.
 *
 * Order is display order: core curriculum, then languages, then sciences, then
 * the technological tracks, with `other` last as the escape hatch.
 */

export const SUPPORTED_SUBJECTS = [
  "math",
  "hebrew",
  "literature",
  "bible",
  "history",
  "civics",
  "english",
  "arabic",
  "physics",
  "chemistry",
  "biology",
  "science",
  "computers",
  "electronics",
  "mechanics",
  "geography",
  "pe",
  "arts",
  "other",
] as const;

export type Subject = (typeof SUPPORTED_SUBJECTS)[number];

/** Narrowing type guard: is the given value one of the supported subjects? */
export function isSupportedSubject(value: unknown): value is Subject {
  return (
    typeof value === "string" &&
    (SUPPORTED_SUBJECTS as readonly string[]).includes(value)
  );
}

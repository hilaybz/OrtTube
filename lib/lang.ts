/**
 * Language constants and resolution for OrtTube's multilingual content layer.
 *
 * Content (quiz prompts/options/explanations) is stored per-language in the
 * `question_translations` / `option_translations` tables. The language a person
 * *reads* a quiz in is resolved by precedence:
 *
 *   profiles.preferred_language -> classes.language -> quizzes.base_language
 *
 * Used by quiz generation + translation, the answer-free student read, and tutor
 * responses.
 */

/** The set of supported content languages. `he`/`ar` are RTL (frontend concern). */
export const SUPPORTED_LANGUAGES = ["he", "ar", "en"] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Narrowing type guard: is the given value one of the supported languages? */
export function isSupportedLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

/**
 * Resolve the language a student should read a quiz in, following the precedence
 * rule above (preferred → class → base). Any argument that is null/undefined or
 * not a supported
 * language is skipped. `quizBase` is the guaranteed fallback (the column is
 * `NOT NULL` in the schema) and is validated too — if a caller somehow passes an
 * unsupported base it falls back to the first supported language so the result is
 * always a valid `Language`.
 *
 * @param studentPref the student's `profiles.preferred_language` (may be null)
 * @param classLang   the `classes.language` of the class the quiz is assigned in
 * @param quizBase    the `quizzes.base_language` (author's language)
 */
export function resolveLanguage(
  studentPref: string | null | undefined,
  classLang: string | null | undefined,
  quizBase: string | null | undefined
): Language {
  if (isSupportedLanguage(studentPref)) return studentPref;
  if (isSupportedLanguage(classLang)) return classLang;
  if (isSupportedLanguage(quizBase)) return quizBase;
  return SUPPORTED_LANGUAGES[0];
}

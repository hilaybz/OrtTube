/**
 * Content (quiz prompts/options/explanations) is stored per-language in the
 * `question_translations` / `option_translations` tables. The language a person
 * *reads* a quiz in is resolved by precedence:
 *
 *   profiles.preferred_language -> classes.language -> quizzes.base_language
 */

export const SUPPORTED_LANGUAGES = ["he", "ar", "en"] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export function isSupportedLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

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

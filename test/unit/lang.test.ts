import { describe, it, expect } from "vitest";
import {
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  resolveLanguage,
} from "@/lib/lang";

describe("SUPPORTED_LANGUAGES", () => {
  it("is exactly he, ar, en", () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(["he", "ar", "en"]);
  });
});

describe("isSupportedLanguage", () => {
  it("accepts supported codes", () => {
    expect(isSupportedLanguage("he")).toBe(true);
    expect(isSupportedLanguage("ar")).toBe(true);
    expect(isSupportedLanguage("en")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isSupportedLanguage("iw")).toBe(false); // legacy Hebrew code, not supported
    expect(isSupportedLanguage("EN")).toBe(false); // case-sensitive
    expect(isSupportedLanguage("")).toBe(false);
    expect(isSupportedLanguage(null)).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
    expect(isSupportedLanguage(42)).toBe(false);
  });
});

describe("resolveLanguage", () => {
  // Precedence: student preference -> class language -> quiz base language.
  // Naming the three positional inputs keeps each case readable.
  type Code = string | null | undefined;
  const languageSeenBy = (prefs: {
    studentPreference: Code;
    classLanguage: Code;
    quizBaseLanguage: Code;
  }) =>
    resolveLanguage(
      prefs.studentPreference,
      prefs.classLanguage,
      prefs.quizBaseLanguage
    );

  it("prefers a valid student preference", () => {
    expect(
      languageSeenBy({
        studentPreference: "ar",
        classLanguage: "he",
        quizBaseLanguage: "en",
      })
    ).toBe("ar");
  });

  it("falls back to class language when student pref is missing", () => {
    expect(
      languageSeenBy({
        studentPreference: null,
        classLanguage: "ar",
        quizBaseLanguage: "en",
      })
    ).toBe("ar");
    expect(
      languageSeenBy({
        studentPreference: undefined,
        classLanguage: "ar",
        quizBaseLanguage: "en",
      })
    ).toBe("ar");
  });

  it("falls back to quiz base when student pref and class lang are missing", () => {
    expect(
      languageSeenBy({
        studentPreference: null,
        classLanguage: null,
        quizBaseLanguage: "en",
      })
    ).toBe("en");
  });

  it("skips unsupported values at each level", () => {
    expect(
      languageSeenBy({
        studentPreference: "iw",
        classLanguage: "ar",
        quizBaseLanguage: "en",
      })
    ).toBe("ar");
    expect(
      languageSeenBy({
        studentPreference: "iw",
        classLanguage: "xx",
        quizBaseLanguage: "en",
      })
    ).toBe("en");
  });

  it("returns the first supported language if nothing resolves", () => {
    expect(
      languageSeenBy({
        studentPreference: null,
        classLanguage: null,
        quizBaseLanguage: null,
      })
    ).toBe("he");
    expect(
      languageSeenBy({
        studentPreference: "xx",
        classLanguage: "yy",
        quizBaseLanguage: "zz",
      })
    ).toBe("he");
  });
});

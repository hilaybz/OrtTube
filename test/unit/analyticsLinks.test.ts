import { describe, it, expect } from "vitest";
import {
  CLASS_ORIGIN,
  STUDENT_ORIGIN,
  classAnalyticsHref,
  classQuizAnalyticsHref,
  quizAnalyticsHref,
  studentAnalyticsHref,
} from "@/components/teacher/analyticsLinks";
import { isBackTargetKey } from "@/components/ui/backTarget";

const CLASS = "5c498dad-3ab1-4c27-b624-af529b33098e";
const QUIZ = "89e38de4-e987-44db-b800-542287d5ff16";
const STUDENT = "4255cc93-057b-41a3-9eec-e3d3dd1c2f34";

describe("the hub's query contract", () => {
  it("addresses each entity as a scope plus an id", () => {
    expect(studentAnalyticsHref("s1")).toBe("/dashboard/analytics?scope=student&id=s1");
    expect(classAnalyticsHref("c1")).toBe("/dashboard/analytics?scope=class&id=c1");
    expect(quizAnalyticsHref("q1")).toBe("/dashboard/analytics?scope=quiz&id=q1");
  });

  it("narrows a quiz to one class with &class=", () => {
    expect(classQuizAnalyticsHref(CLASS, QUIZ)).toBe(
      `/dashboard/analytics?scope=quiz&id=${QUIZ}&class=${CLASS}`
    );
  });

  it("encodes ids rather than interpolating them raw", () => {
    expect(classQuizAnalyticsHref("a b/c", "q")).toContain("class=a%20b%2Fc");
  });
});

describe("where back goes from a class-filtered quiz", () => {
  it("marks a link followed out of a class's own analytics", () => {
    // Without an origin the quiz view cannot tell a reader who drilled in from
    // the class from one who picked a class in the dropdown, and back dropped
    // the filter for both — landing the first on "כל הכיתות", not the class.
    expect(classQuizAnalyticsHref(CLASS, QUIZ, { from: CLASS_ORIGIN })).toBe(
      `/dashboard/analytics?scope=quiz&id=${QUIZ}&class=${CLASS}&from=${CLASS_ORIGIN}`
    );
  });

  it("carries a student's id, which nothing else in the URL supplies", () => {
    // A class needs only the marker (`&class=` is already there); a student has
    // no other reason to appear in a quiz URL, so the id travels with the origin.
    expect(
      classQuizAnalyticsHref(CLASS, QUIZ, { from: STUDENT_ORIGIN, studentId: STUDENT })
    ).toBe(
      `/dashboard/analytics?scope=quiz&id=${QUIZ}&class=${CLASS}` +
        `&from=${STUDENT_ORIGIN}&student=${STUDENT}`
    );
  });

  it("encodes the student id too", () => {
    expect(
      classQuizAnalyticsHref(CLASS, QUIZ, { from: STUDENT_ORIGIN, studentId: "a b/c" })
    ).toContain("student=a%20b%2Fc");
  });

  it("stays unmarked by default, so every other caller is unchanged", () => {
    // The class dropdown and the quiz's own per-class table reach the same URL
    // without having drilled in from an entity; back stays on the quiz.
    const plain = classQuizAnalyticsHref(CLASS, QUIZ);
    expect(plain).not.toContain("from=");
    expect(classQuizAnalyticsHref(CLASS, QUIZ, undefined)).toBe(plain);
  });

  it("uses no value that a registered back-target key would shadow", () => {
    // `from` is shared with the BACK_TARGETS registry. That registry holds only
    // places; these name a row, resolved by the page against `&class=`/`&student=`.
    // Were either also a key, the registry would win and back would go elsewhere.
    expect(isBackTargetKey(CLASS_ORIGIN)).toBe(false);
    expect(isBackTargetKey(STUDENT_ORIGIN)).toBe(false);
  });
});

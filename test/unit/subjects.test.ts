import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SUPPORTED_SUBJECTS, isSupportedSubject } from "@/lib/subjects";
import { SUBJECT_LABELS } from "@/components/teacher/classes/labels";

describe("isSupportedSubject", () => {
  it("accepts every supported subject", () => {
    for (const subject of SUPPORTED_SUBJECTS) {
      expect(isSupportedSubject(subject)).toBe(true);
    }
  });

  it("rejects everything else", () => {
    expect(isSupportedSubject("mathematics")).toBe(false); // not the stored key
    expect(isSupportedSubject("MATH")).toBe(false); // case-sensitive
    expect(isSupportedSubject("מתמטיקה")).toBe(false); // label, not value
    expect(isSupportedSubject("")).toBe(false);
    expect(isSupportedSubject(null)).toBe(false);
    expect(isSupportedSubject(undefined)).toBe(false);
    expect(isSupportedSubject(42)).toBe(false);
  });
});

describe("the subject vocabulary", () => {
  /**
   * `classes.subject` is a CHECK-constrained column, so the list in
   * `lib/subjects.ts` is a mirror of one in SQL. Nothing at compile time ties
   * the two together: add a subject to the CHECK and forget the TypeScript and
   * the UI silently can't offer it; add it to TypeScript and forget the CHECK
   * and creating such a class fails at the database with a constraint
   * violation. Reading the migration back is the only check that catches drift.
   */
  it("matches the CHECK constraint in the migration", () => {
    const migration = readFileSync(
      "supabase/migrations/140_class_subject.sql",
      "utf8"
    );
    const check = migration.match(/check \(subject in \(([\s\S]*?)\)\)/);
    expect(check).not.toBeNull();

    const inSql = [...check![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(inSql).toEqual([...SUPPORTED_SUBJECTS]);
  });

  it("has a Hebrew label for every subject, and no orphan labels", () => {
    expect(Object.keys(SUBJECT_LABELS)).toEqual([...SUPPORTED_SUBJECTS]);
    for (const label of Object.values(SUBJECT_LABELS)) {
      expect(label.trim()).not.toBe("");
    }
  });

  it("keeps `other` last so it reads as the fallback in the picker", () => {
    expect(SUPPORTED_SUBJECTS.at(-1)).toBe("other");
  });
});

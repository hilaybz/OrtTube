import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "supabase", "migrations");

const LEGACY_VERSIONS = new Set([
  "010", "011", "012", "013", "014", "015", "030", "040", "041", "050", "051",
  "060", "061", "062", "063", "064", "070", "080", "090", "091", "092", "093",
  "100", "110", "120", "121", "122", "123", "124", "125", "126", "127", "128",
  "129", "130", "131", "132", "133", "134", "135", "136", "137", "138", "139",
  "141", "142", "143", "144", "145", "146", "147", "148", "149",
]);

function migrationFiles(): string[] {
  return readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
}

function versionOf(file: string): string {
  return file.split("_")[0];
}

describe("supabase/migrations", () => {
  it("gives every migration a unique version", () => {
    const seen = new Map<string, string[]>();
    for (const file of migrationFiles()) {
      const version = versionOf(file);
      seen.set(version, [...(seen.get(version) ?? []), file]);
    }
    const collisions = [...seen.entries()].filter(([, files]) => files.length > 1);
    expect(collisions).toEqual([]);
  });

  it("names every new migration with a timestamp, never the next number", () => {
    const offenders = migrationFiles().filter((file) => {
      const version = versionOf(file);
      if (LEGACY_VERSIONS.has(version)) return false;
      return !/^\d{14}$/.test(version);
    });
    expect(offenders).toEqual([]);
  });

  it("keeps the legacy numeric block frozen", () => {
    const present = new Set(
      migrationFiles().map(versionOf).filter((v) => /^\d{3}$/.test(v))
    );
    const removed = [...LEGACY_VERSIONS].filter((v) => !present.has(v));
    expect(removed).toEqual([]);
  });
});

/**
 * The `?from=` registry behind contextual back navigation: a short key on an
 * outgoing link, resolved on the page that link opened.
 */
import { describe, it, expect } from "vitest";
import {
  BACK_PARAM,
  BACK_TARGETS,
  isBackTargetKey,
  resolveBackTarget,
  withBackTarget,
} from "@/components/ui/backTarget";

const FALLBACK = { href: "/dashboard/quizzes", label: "החידונים שלי" };

describe("withBackTarget", () => {
  it("appends the key to a plain href", () => {
    expect(withBackTarget("/dashboard/quizzes/new", "overview")).toBe(
      "/dashboard/quizzes/new?from=overview"
    );
  });

  it("keeps a query string the href already carries", () => {
    expect(withBackTarget("/dashboard/analytics?scope=class&id=7", "overview")).toBe(
      "/dashboard/analytics?scope=class&id=7&from=overview"
    );
  });

  it("keeps the hash at the end, where a browser expects it", () => {
    expect(withBackTarget("/dashboard/quizzes/7/edit#q3", "overview")).toBe(
      "/dashboard/quizzes/7/edit?from=overview#q3"
    );
  });

  it("uses the same param name the resolver reads", () => {
    expect(withBackTarget("/x", "feed")).toContain(`${BACK_PARAM}=feed`);
  });
});

describe("resolveBackTarget", () => {
  it("resolves a registered key to its named destination", () => {
    expect(resolveBackTarget("overview", FALLBACK)).toEqual(BACK_TARGETS.overview);
  });

  it("falls back to the page's own destination when nothing was passed", () => {
    expect(resolveBackTarget(undefined, FALLBACK)).toEqual(FALLBACK);
    expect(resolveBackTarget(null, FALLBACK)).toEqual(FALLBACK);
    expect(resolveBackTarget("", FALLBACK)).toEqual(FALLBACK);
  });

  it("ignores an unknown or hand-edited key rather than trusting the URL", () => {
    expect(resolveBackTarget("nowhere", FALLBACK)).toEqual(FALLBACK);
    expect(resolveBackTarget("https://evil.example", FALLBACK)).toEqual(FALLBACK);
    // Not a key just because `Object` has such a property.
    expect(resolveBackTarget("toString", FALLBACK)).toEqual(FALLBACK);
  });

  it("takes the first value of a repeated param — the link actually followed", () => {
    expect(resolveBackTarget(["classes", "feed"], FALLBACK)).toEqual(BACK_TARGETS.classes);
  });

  it("names every destination, so a back link can always say where it goes", () => {
    for (const [key, target] of Object.entries(BACK_TARGETS)) {
      expect(isBackTargetKey(key)).toBe(true);
      expect(target.href.startsWith("/")).toBe(true);
      expect(target.label.trim().length).toBeGreaterThan(0);
      // The label names the place, never the action.
      expect(target.label).not.toContain("חזרה");
    }
  });
});

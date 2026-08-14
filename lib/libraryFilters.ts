import type { QuizAllocationTags } from "@/lib/allocations";

/**
 * Pure search/filter/sort helpers for the teacher quiz library (backlog 1.4).
 * Deliberately dependency-free beyond the `QuizAllocationTags` type (a
 * type-only import, so it vanishes at compile time — same "safe to import
 * from a client bundle" reasoning as `lib/allocationState.ts`). Everything
 * here runs entirely client-side: neither `list_my_quizzes` nor
 * `list_shared_quizzes` paginates, so the full list is already in memory.
 */

// ── Sort ─────────────────────────────────────────────────────────────────────

export type SortOption = "date_desc" | "date_asc" | "count_desc" | "count_asc";

export const SORT_LABELS: Record<SortOption, string> = {
  date_desc: "תאריך יצירה (החדש קודם)",
  date_asc: "תאריך יצירה (הישן קודם)",
  count_desc: "מספר שאלות (מהרב למעט)",
  count_asc: "מספר שאלות (מהמעט לרב)",
};

export const SORT_OPTIONS = Object.keys(SORT_LABELS) as SortOption[];

/**
 * Returns a NEW sorted array (never mutates `quizzes`) so callers can safely
 * use it inside a `useMemo` alongside the object it was given.
 */
export function sortQuizzes<T extends { created_at: string; question_count: number }>(
  quizzes: T[],
  sort: SortOption
): T[] {
  const sorted = [...quizzes];
  sorted.sort((a, b) => {
    switch (sort) {
      case "date_desc":
        return b.created_at.localeCompare(a.created_at);
      case "date_asc":
        return a.created_at.localeCompare(b.created_at);
      case "count_desc":
        return b.question_count - a.question_count;
      case "count_asc":
        return a.question_count - b.question_count;
    }
  });
  return sorted;
}

// ── Search ───────────────────────────────────────────────────────────────────

/**
 * True when `query` is blank (no filtering) or found, case-insensitively, in
 * any of `haystacks` — `null`/`undefined` fields (e.g. an untitled quiz, or a
 * video whose channel name never resolved) are simply skipped rather than
 * matching or throwing.
 */
export function matchesText(
  haystacks: (string | null | undefined)[],
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystacks.some((h) => h != null && h.toLowerCase().includes(q));
}

// ── Class-assignment filter (My quizzes only) ───────────────────────────────

/** Sentinel selected value for "not assigned to any class." */
export const UNASSIGNED_CLASS = "__unassigned__";

/**
 * `tags` is `undefined` exactly when the quiz has no allocation at all
 * (`list_my_quiz_allocation_tags` omits quizzes with zero allocations rather
 * than returning empty buckets for them) — that's the signal `UNASSIGNED_CLASS`
 * matches on. Otherwise a quiz matches if ANY selected class id appears in
 * either its `live` or `scheduled` bucket (OR within the axis).
 */
export function matchesClassFilter(
  selected: Set<string>,
  tags: QuizAllocationTags | undefined
): boolean {
  if (selected.size === 0) return true;
  if (tags === undefined) return selected.has(UNASSIGNED_CLASS);
  const assignedIds = new Set([...tags.live, ...tags.scheduled].map((c) => c.class_id));
  for (const s of selected) {
    if (s !== UNASSIGNED_CLASS && assignedIds.has(s)) return true;
  }
  return false;
}

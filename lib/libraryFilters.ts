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

/**
 * Recency is the only ordering the library offers: a teacher looks for the quiz
 * they just built, or the one from last term. Ordering by number of questions
 * answered no real question ("which quiz has 9 questions?") and cost the
 * library a whole control's worth of attention.
 */
export type SortOption = "date_desc" | "date_asc";

export const SORT_LABELS: Record<SortOption, string> = {
  date_desc: "החדש קודם",
  date_asc: "הישן קודם",
};

export const SORT_OPTIONS = Object.keys(SORT_LABELS) as SortOption[];

/**
 * Returns a NEW sorted array (never mutates `quizzes`) so callers can safely
 * use it inside a `useMemo` alongside the object it was given.
 */
export function sortQuizzes<T extends { created_at: string }>(
  quizzes: T[],
  sort: SortOption
): T[] {
  const sorted = [...quizzes];
  sorted.sort((a, b) =>
    sort === "date_desc"
      ? b.created_at.localeCompare(a.created_at)
      : a.created_at.localeCompare(b.created_at)
  );
  return sorted;
}

// ── Visibility ───────────────────────────────────────────────────────────────

/** Library visibility axis: everything, or one of the two stored values. */
export type VisibilityFilter = "all" | "private" | "shared";

export const VISIBILITY_SEGMENTS: ReadonlyArray<{
  value: VisibilityFilter;
  label: string;
}> = [
  { value: "all", label: "הכל" },
  { value: "private", label: "פרטי" },
  { value: "shared", label: "משותף" },
];

/** `all` matches everything; otherwise the quiz's own visibility must match. */
export function matchesVisibility(
  filter: VisibilityFilter,
  visibility: "private" | "shared"
): boolean {
  return filter === "all" || filter === visibility;
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
 * A quiz counts as "not assigned to any class" (matches `UNASSIGNED_CLASS`)
 * whenever it has no LIVE or SCHEDULED class — which covers both `tags`
 * being `undefined` (no allocation at all — `list_my_quiz_allocation_tags`
 * omits those quizzes entirely) AND `tags` being present with both buckets
 * empty (a quiz whose only allocations are drafts or closed windows; the
 * RPC deliberately still returns a row for those, per its own doc comment —
 * see `QuizCard.tsx`'s `AllocationTagsRow`, which renders "לא פעיל" for the
 * exact same case). Treating only `undefined` as unassigned left a
 * draft/closed-only quiz unreachable under EVERY filter selection, "לא משויך"
 * included. Otherwise a quiz matches if ANY selected class id appears in
 * either its `live` or `scheduled` bucket (OR within the axis).
 */
export function matchesClassFilter(
  selected: Set<string>,
  tags: QuizAllocationTags | undefined
): boolean {
  if (selected.size === 0) return true;
  const assignedIds = new Set(
    [...(tags?.live ?? []), ...(tags?.scheduled ?? [])].map((c) => c.class_id)
  );
  const unassigned = assignedIds.size === 0;
  for (const s of selected) {
    if (s === UNASSIGNED_CLASS ? unassigned : assignedIds.has(s)) return true;
  }
  return false;
}

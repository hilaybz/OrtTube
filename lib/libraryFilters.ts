import type { QuizAllocationTags } from "@/lib/allocations";

/**
 * Deliberately dependency-free beyond the `QuizAllocationTags` type (a
 * type-only import, so it vanishes at compile time — same "safe to import
 * from a client bundle" reasoning as `lib/allocationState.ts`). Everything
 * here runs entirely client-side: neither `list_my_quizzes` nor
 * `list_shared_quizzes` paginates, so the full list is already in memory.
 */

export type SortOption = "date_desc" | "date_asc";

export const SORT_LABELS: Record<SortOption, string> = {
  date_desc: "החדש קודם",
  date_asc: "הישן קודם",
};

export const SORT_OPTIONS = Object.keys(SORT_LABELS) as SortOption[];

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

export type VisibilityFilter = "all" | "private" | "shared";

export const VISIBILITY_OPTIONS: ReadonlyArray<{
  value: VisibilityFilter;
  label: string;
}> = [
  { value: "all", label: "הכל" },
  { value: "private", label: "פרטי" },
  { value: "shared", label: "משותף" },
];

export function matchesVisibility(
  filter: VisibilityFilter,
  visibility: "private" | "shared"
): boolean {
  return filter === "all" || filter === visibility;
}

/**
 * Where a quiz stands across all its classes — the same axis the teacher
 * home's KPI tiles count, so a tile and this filter can never disagree:
 * `active` is a quiz at least one class can still reach (live OR scheduled),
 * `finished` is one that has run and has no class still open on it, and a quiz
 * that was never published to anyone (drafts, and quizzes with no allocation
 * at all) is neither — it appears only under `all`.
 */
export type StatusFilter = "all" | "active" | "finished";

export const STATUS_OPTIONS: ReadonlyArray<{
  value: StatusFilter;
  label: string;
}> = [
  { value: "all", label: "הכל" },
  { value: "active", label: "פעילים" },
  { value: "finished", label: "הסתיימו" },
];

export function normalizeStatusParam(
  raw: string | string[] | undefined
): StatusFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "active" || value === "finished" ? value : "all";
}

/**
 * `all` matches everything. Otherwise the quiz's buckets decide, mirroring
 * `countQuizStates` in the overview's `aggregate.ts`: any live or scheduled
 * class makes it active (even if other classes have already closed — a quiz
 * mid-rollout is still open work), and only a quiz with no live/scheduled
 * class but at least one closed window counts as finished. `undefined` tags
 * mean the quiz has no allocation at all, which is neither.
 */
export function matchesStatus(
  filter: StatusFilter,
  tags: QuizAllocationTags | undefined
): boolean {
  if (filter === "all") return true;
  const openable = (tags?.live.length ?? 0) + (tags?.scheduled.length ?? 0) > 0;
  return filter === "active" ? openable : !openable && (tags?.closed.length ?? 0) > 0;
}

export function matchesText(
  haystacks: (string | null | undefined)[],
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystacks.some((h) => h != null && h.toLowerCase().includes(q));
}

export const UNASSIGNED_CLASS = "__unassigned__";

/**
 * "Assigned to this class" spans EVERY published state — live, scheduled and
 * already closed. A closed window still happened in that class, and leaving it
 * out made the two axes contradict each other: picking a class plus
 * `finished` (the status a KPI tile deep-links into) could only ever yield an
 * empty grid, since a quiz that has closed everywhere had no matching class.
 *
 * A quiz counts as "not assigned to any class" (matches `UNASSIGNED_CLASS`)
 * when none of those buckets names a class — which covers both `tags` being
 * `undefined` (no allocation at all: `list_my_quiz_allocation_tags` omits
 * those quizzes entirely) AND `tags` being present with every bucket empty (a
 * quiz whose only allocations are drafts; the RPC deliberately still returns a
 * row for those, per its own doc comment — see `QuizCard.tsx`'s
 * `AllocationLine`, which renders "טיוטה" for the exact same case). Treating
 * only `undefined` as unassigned left a draft-only quiz unreachable under
 * EVERY filter selection, "לא משויך" included. Otherwise a quiz matches if ANY
 * selected class id appears in any bucket (OR within the axis).
 */
export function matchesClassFilter(
  selected: Set<string>,
  tags: QuizAllocationTags | undefined
): boolean {
  if (selected.size === 0) return true;
  const assignedIds = new Set(
    [
      ...(tags?.live ?? []),
      ...(tags?.scheduled ?? []),
      ...(tags?.closed ?? []),
    ].map((c) => c.class_id)
  );
  const unassigned = assignedIds.size === 0;
  for (const s of selected) {
    if (s === UNASSIGNED_CLASS ? unassigned : assignedIds.has(s)) return true;
  }
  return false;
}

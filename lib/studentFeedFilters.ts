import type { StudentFeedItem, StudentFeedStatus } from "@/lib/classes";
import { matchesText } from "@/lib/libraryFilters";

/**
 * Pure search/filter/sort helpers for the student feed — the student-side
 * counterpart of `lib/libraryFilters.ts`. Everything runs client-side:
 * `list_student_feed` returns the whole feed in one shot and never paginates,
 * so the full list is already in memory.
 *
 * The text predicate itself is shared with the teacher library
 * (`matchesText`); only the fields searched and the sort axes differ, since a
 * feed item carries a class and a deadline rather than a visibility and a
 * question count.
 */

// ── Section bucketing ────────────────────────────────────────────────────────

/** The two sections the feed is split into, each with its own default sort. */
export type FeedSection = "not_yet" | "finished";

const SECTION_OF: Record<StudentFeedStatus, FeedSection> = {
  not_started: "not_yet",
  in_progress: "not_yet",
  completed: "finished",
  missed: "finished",
};

export function sectionOf(item: StudentFeedItem): FeedSection {
  return SECTION_OF[item.status];
}

const STATUSES = Object.keys(SECTION_OF) as StudentFeedStatus[];

/**
 * Whether a section is worth rendering at all under the current status
 * filter. A status filter of "completed only" makes the whole "not yet
 * attempted" section moot, so it is dropped rather than left standing with an
 * empty-results message the student already knows the reason for.
 */
export function sectionSelected(
  section: FeedSection,
  statuses: Set<StudentFeedStatus>
): boolean {
  if (statuses.size === 0) return true;
  return STATUSES.some((s) => statuses.has(s) && SECTION_OF[s] === section);
}

// ── Sort ─────────────────────────────────────────────────────────────────────

/**
 * The only axis a student sorts by: the submission deadline. Everything else a
 * feed item carries (assignment date, title, completion time) is the teacher's
 * bookkeeping, not the student's question — "what is due next" is.
 */
export type FeedSortOption = "deadline_asc" | "deadline_desc";

export const FEED_SORT_LABELS: Record<FeedSortOption, string> = {
  deadline_asc: "מועד הגשה (הקרוב קודם)",
  deadline_desc: "מועד הגשה (הרחוק קודם)",
};

export const FEED_SORT_OPTIONS = Object.keys(FEED_SORT_LABELS) as FeedSortOption[];

/** The default: soonest deadline first, i.e. most urgent on top. */
export const DEFAULT_FEED_SORT: FeedSortOption = "deadline_asc";

/** The text a card shows as its heading. */
export function feedHeading(item: StudentFeedItem): string {
  return item.title ?? item.video_title ?? "חידון";
}

/**
 * Returns a NEW sorted array (never mutates `items`). A quiz with no deadline
 * sinks to the end under BOTH directions rather than flipping to the top under
 * `deadline_desc`: "no deadline" is the absence of a submission date, not a
 * date infinitely far out, so it never outranks a real one. Ties (including
 * two deadline-less items) keep their incoming order — `list_student_feed`
 * already returns rows in a stable order.
 */
export function sortFeed(
  items: StudentFeedItem[],
  sort: FeedSortOption
): StudentFeedItem[] {
  const deadline = (item: StudentFeedItem): number | null =>
    item.available_until ? new Date(item.available_until).getTime() : null;
  return [...items].sort((a, b) => {
    const da = deadline(a);
    const db = deadline(b);
    if (da === null || db === null) {
      if (da === db) return 0;
      return da === null ? 1 : -1;
    }
    return sort === "deadline_asc" ? da - db : db - da;
  });
}

// ── Search + filters ─────────────────────────────────────────────────────────

export interface FeedFilters {
  search: string;
  /** Empty = every class. Selected class ids, OR-matched. */
  classes: Set<string>;
  /** Empty = every status. Selected statuses, OR-matched. */
  statuses: Set<StudentFeedStatus>;
}

export const EMPTY_FEED_FILTERS: FeedFilters = {
  search: "",
  classes: new Set(),
  statuses: new Set(),
};

export function hasActiveFilters(filters: FeedFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.classes.size > 0 ||
    filters.statuses.size > 0
  );
}

/**
 * AND across axes, OR within each: an item survives when its text matches the
 * query AND its class is selected (or no class is) AND its status is selected
 * (or no status is). Search covers what a student would recognise a quiz by —
 * its own title, the video's title, and the class and teacher it came from.
 */
export function matchesFeedFilters(
  item: StudentFeedItem,
  filters: FeedFilters
): boolean {
  return (
    matchesText(
      [item.title, item.video_title, item.class_name, item.teacher_name],
      filters.search
    ) &&
    (filters.classes.size === 0 || filters.classes.has(item.class_id)) &&
    (filters.statuses.size === 0 || filters.statuses.has(item.status))
  );
}

/** The distinct classes present in the feed, alphabetical — the class filter's options. */
export function feedClassOptions(
  items: StudentFeedItem[]
): { value: string; label: string }[] {
  const byId = new Map<string, string>();
  for (const item of items) byId.set(item.class_id, item.class_name);
  return [...byId]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "he"));
}

// ── What's next ──────────────────────────────────────────────────────────────

/**
 * The one-line read on a student's feed, for the greeting header: how much is
 * still owed and which of it is due soonest.
 *
 * "Owed" is the `not_yet` section — not started or mid-attempt. A completed
 * quiz is settled and a missed one can no longer be acted on, so neither is
 * something to greet a student with.
 */
export interface FeedOutlook {
  /** How many quizzes the student still has to submit. */
  pending: number;
  /**
   * The pending quiz with the nearest deadline, or `null` when nothing pending
   * has one. A deadline-less quiz is never "due next": there is no date for it
   * to be next *by*, and calling the arbitrary first one next would tell a
   * student to hurry over the one thing that isn't urgent.
   */
  next: StudentFeedItem | null;
}

export function feedOutlook(items: StudentFeedItem[]): FeedOutlook {
  const pending = items.filter((i) => sectionOf(i) === "not_yet");
  const dated = pending.filter((i) => i.available_until != null);
  const next = dated.reduce<StudentFeedItem | null>((soonest, item) => {
    if (!soonest) return item;
    return new Date(item.available_until as string).getTime() <
      new Date(soonest.available_until as string).getTime()
      ? item
      : soonest;
  }, null);
  return { pending: pending.length, next };
}

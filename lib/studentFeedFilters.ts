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

export type FeedSortOption =
  | "smart"
  | "deadline_asc"
  | "assigned_desc"
  | "assigned_asc"
  | "title_asc";

export const FEED_SORT_LABELS: Record<FeedSortOption, string> = {
  smart: "מומלץ",
  deadline_asc: "מועד סיום (הקרוב קודם)",
  assigned_desc: "תאריך הקצאה (החדש קודם)",
  assigned_asc: "תאריך הקצאה (הישן קודם)",
  title_asc: "שם החידון (א׳–ת׳)",
};

export const FEED_SORT_OPTIONS = Object.keys(FEED_SORT_LABELS) as FeedSortOption[];

/** The text a card shows as its heading — also what `title_asc` sorts on. */
export function feedHeading(item: StudentFeedItem): string {
  return item.title ?? item.video_title ?? "חידון";
}

const time = (iso: string | null): number => (iso ? new Date(iso).getTime() : 0);

/**
 * Sort the "not yet attempted" section by soonest deadline first — this
 * section answers "what do I need to do before I run out of time," so the
 * most urgent item belongs on top. No-deadline items carry no urgency, so
 * they sink to the end (newest-assigned-first among themselves).
 */
export function sortNotYetAttempted(items: StudentFeedItem[]): StudentFeedItem[] {
  return [...items].sort((a, b) => {
    const da = a.available_until ? new Date(a.available_until).getTime() : Infinity;
    const db = b.available_until ? new Date(b.available_until).getTime() : Infinity;
    if (da !== db) return da - db;
    return time(b.assigned_at) - time(a.assigned_at);
  });
}

/**
 * Sort the "finished" section by most recent activity first — this section
 * is a history view, so "what did I just do" is the natural read. A missed
 * quiz has no completion timestamp, so its window's own close time stands
 * in as "when it became finished."
 */
export function sortFinished(items: StudentFeedItem[]): StudentFeedItem[] {
  const activity = (item: StudentFeedItem): number =>
    time(item.status === "missed" ? item.available_until : item.last_completed_at);
  return [...items].sort((a, b) => activity(b) - activity(a));
}

/**
 * Returns a NEW sorted array (never mutates `items`). `"smart"` is the
 * default and delegates to the section's own ordering above — deadline-first
 * for work still owed, most-recent-activity-first for history — which is why
 * sorting takes the section rather than being section-blind. Every other
 * option means the same thing in both sections.
 *
 * `deadline_asc` keeps `"smart"`'s rule for a deadline-less item: no deadline
 * is no urgency, so it sinks below every dated one instead of sorting as
 * though it were due at the epoch.
 */
export function sortFeed(
  items: StudentFeedItem[],
  sort: FeedSortOption,
  section: FeedSection
): StudentFeedItem[] {
  switch (sort) {
    case "smart":
      return section === "not_yet" ? sortNotYetAttempted(items) : sortFinished(items);
    case "deadline_asc":
      return [...items].sort((a, b) => {
        const da = a.available_until ? new Date(a.available_until).getTime() : Infinity;
        const db = b.available_until ? new Date(b.available_until).getTime() : Infinity;
        return da - db;
      });
    case "assigned_desc":
      return [...items].sort((a, b) => time(b.assigned_at) - time(a.assigned_at));
    case "assigned_asc":
      return [...items].sort((a, b) => time(a.assigned_at) - time(b.assigned_at));
    case "title_asc":
      return [...items].sort((a, b) =>
        feedHeading(a).localeCompare(feedHeading(b), "he")
      );
  }
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

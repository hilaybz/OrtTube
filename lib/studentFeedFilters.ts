import type { StudentFeedItem, StudentFeedStatus } from "@/lib/classes";
import { matchesText } from "@/lib/libraryFilters";

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

export function sectionSelected(
  section: FeedSection,
  statuses: Set<StudentFeedStatus>
): boolean {
  if (statuses.size === 0) return true;
  return STATUSES.some((s) => statuses.has(s) && SECTION_OF[s] === section);
}

export type FeedSortOption = "deadline_asc" | "deadline_desc";

export const FEED_SORT_LABELS: Record<FeedSortOption, string> = {
  deadline_asc: "מועד הגשה (הקרוב קודם)",
  deadline_desc: "מועד הגשה (הרחוק קודם)",
};

export const FEED_SORT_OPTIONS = Object.keys(FEED_SORT_LABELS) as FeedSortOption[];

export const DEFAULT_FEED_SORT: FeedSortOption = "deadline_asc";

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

export interface FeedFilters {
  search: string;
  classes: Set<string>;
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

export function feedClassOptions(
  items: StudentFeedItem[]
): { value: string; label: string }[] {
  const byId = new Map<string, string>();
  for (const item of items) byId.set(item.class_id, item.class_name);
  return [...byId]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "he"));
}

export interface FeedOutlook {
  pending: number;
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

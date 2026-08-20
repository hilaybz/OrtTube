"use client";
import { useMemo, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Field } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { Select } from "@/components/ui/Select";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { Pager } from "@/components/ui/Pager";
import { usePagedList } from "@/components/ui/usePagedList";
import { QuizCard } from "./QuizCard";
import type { StudentFeedItem, StudentFeedStatus } from "@/lib/classes";
import {
  sectionOf,
  sectionSelected,
  sortFeed,
  matchesFeedFilters,
  hasActiveFilters,
  feedClassOptions,
  DEFAULT_FEED_SORT,
  FEED_SORT_LABELS,
  FEED_SORT_OPTIONS,
  type FeedSection,
  type FeedSortOption,
} from "@/lib/studentFeedFilters";

const STATUS_OPTIONS: { value: StudentFeedStatus; label: string }[] = [
  { value: "not_started", label: "טרם התחלת" },
  { value: "in_progress", label: "בתהליך" },
  { value: "completed", label: "הושלם" },
  { value: "missed", label: "פוספס" },
];

const SECTION_TITLE: Record<FeedSection, string> = {
  not_yet: "טרם ניסית",
  finished: "הושלמו",
};

/** What a section says when the student has nothing in it at all (no filters involved). */
const SECTION_EMPTY: Record<FeedSection, string> = {
  not_yet: "עדיין אין חידונים שממתינים לך. חידונים חדשים שיוקצו למקצועות שלך יופיעו כאן.",
  finished: "עדיין לא סיימת אף חידון. אחרי שתשלימו ניסיון, הוא יופיע כאן.",
};

/** Two full rows of the three-column grid before a reader has to page. */
const CARDS_PER_PAGE = 6;

function FeedSectionView({
  section,
  items,
  filtered,
  filtersActive,
  resetKey,
}: {
  section: FeedSection;
  /** Every item in this section, before search/filters — drives the "you have nothing here" copy. */
  items: StudentFeedItem[];
  /** What survived search/filters, already sorted. */
  filtered: StudentFeedItem[];
  filtersActive: boolean;
  /** Any change to search/filters/sort returns this section to its first page. */
  resetKey: string;
}) {
  const paged = usePagedList(filtered, { pageSize: CARDS_PER_PAGE, resetKey });
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-[var(--heading)]">
        {SECTION_TITLE[section]}
      </h2>
      {filtered.length === 0 ? (
        <GlassCard>
          <p className="text-[var(--body)]">
            {items.length > 0 && filtersActive
              ? "אין חידונים התואמים את החיפוש."
              : SECTION_EMPTY[section]}
          </p>
        </GlassCard>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {paged.slice.map((item) => (
              <QuizCard key={`${item.class_id}:${item.quiz_id}`} item={item} />
            ))}
          </div>
          <Pager {...paged} label={`ניווט בין חידונים — ${SECTION_TITLE[section]}`} />
        </>
      )}
    </section>
  );
}

/**
 * The student feed: every quiz assigned to any of their classes, split into
 * "not yet attempted" and "finished" (see `lib/studentFeedFilters.ts` for the
 * bucketing and the sort).
 *
 * Search/filter/sort (backlog 4.2) mirror the teacher library's (1.4) and run
 * entirely client-side — `list_student_feed` hands over the whole feed in one
 * query. One control bar governs BOTH sections rather than a bar per section: a
 * student searching for a quiz doesn't know, or care, which section it landed
 * in. The subject filter appears only once a student is in more than one
 * subject, where it starts to mean something. Sorting is deadline-only, both
 * directions — the one ordering a student actually asks for. Each section pages
 * independently, so a long finished list never buries what is still due.
 */
export function StudentFeed({ items }: { items: StudentFeedItem[] }) {
  const [search, setSearch] = useState("");
  const [classes, setClasses] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<StudentFeedStatus>>(new Set());
  const [sort, setSort] = useState<FeedSortOption>(DEFAULT_FEED_SORT);

  const filters = useMemo(
    () => ({ search, classes, statuses }),
    [search, classes, statuses]
  );
  const filtersActive = hasActiveFilters(filters);
  const classOptions = useMemo(() => feedClassOptions(items), [items]);

  const sections = useMemo(() => {
    const bucket = (section: FeedSection) => {
      const all = items.filter((i) => sectionOf(i) === section);
      const filtered = sortFeed(
        all.filter((i) => matchesFeedFilters(i, filters)),
        sort
      );
      return { section, all, filtered };
    };
    return (["not_yet", "finished"] as const)
      .filter((section) => sectionSelected(section, statuses))
      .map(bucket);
  }, [items, filters, statuses, sort]);

  // Narrowing the feed must not leave the reader stranded on a page that no
  // longer exists, so every control that changes what is listed resets paging.
  const pageResetKey = [
    search.trim(),
    [...classes].sort().join(","),
    [...statuses].sort().join(","),
    sort,
  ].join("|");

  function clearFilters() {
    setSearch("");
    setClasses(new Set());
    setStatuses(new Set());
  }

  return (
    <div className="flex flex-col gap-6">
      {items.length > 0 && (
        <GlassCard className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px] flex-1">
            <Field
              label="חיפוש"
              name="feed-search"
              placeholder="לפי שם החידון, הסרטון, המקצוע או המורה"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {classOptions.length > 1 && (
            <MultiSelectDropdown
              label="מקצוע"
              options={classOptions}
              selected={classes}
              onChange={setClasses}
            />
          )}
          <MultiSelectDropdown
            label="מצב"
            options={STATUS_OPTIONS}
            selected={statuses}
            onChange={setStatuses}
          />
          <Select
            label="מיון"
            name="feed-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as FeedSortOption)}
          >
            {FEED_SORT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {FEED_SORT_LABELS[opt]}
              </option>
            ))}
          </Select>
          {filtersActive && (
            <IconButton
              name="filterOff"
              label="נקה מסננים"
              className="mb-0.5"
              onClick={clearFilters}
            />
          )}
        </GlassCard>
      )}
      <div className="flex flex-col gap-8">
        {sections.map(({ section, all, filtered }) => (
          <FeedSectionView
            key={section}
            section={section}
            items={all}
            filtered={filtered}
            filtersActive={filtersActive}
            resetKey={pageResetKey}
          />
        ))}
      </div>
    </div>
  );
}

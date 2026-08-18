"use client";
import { useMemo, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { QuizCard } from "./QuizCard";
import type { StudentFeedItem, StudentFeedStatus } from "@/lib/classes";
import {
  sectionOf,
  sectionSelected,
  sortFeed,
  matchesFeedFilters,
  hasActiveFilters,
  feedClassOptions,
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
  not_yet: "עדיין אין חידונים שממתינים לך. חידונים חדשים שיוקצו לכיתות שלך יופיעו כאן.",
  finished: "עדיין לא סיימת אף חידון. אחרי שתשלימו ניסיון, הוא יופיע כאן.",
};

function FeedSectionView({
  section,
  items,
  filtered,
  filtersActive,
}: {
  section: FeedSection;
  /** Every item in this section, before search/filters — drives the "you have nothing here" copy. */
  items: StudentFeedItem[];
  /** What survived search/filters, already sorted. */
  filtered: StudentFeedItem[];
  filtersActive: boolean;
}) {
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
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <QuizCard key={`${item.class_id}:${item.quiz_id}`} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The student feed: every quiz assigned to any of their classes, split into
 * "not yet attempted" and "finished" (see `lib/studentFeedFilters.ts` for the
 * bucketing and each section's default sort).
 *
 * Search/filter/sort (backlog 4.2) work exactly like the teacher library's
 * (1.4) and run entirely client-side — `list_student_feed` hands over the whole
 * feed in one query. One control bar governs BOTH sections rather than a bar
 * per section: a student searching for a quiz doesn't know, or care, which
 * section it landed in. The class filter appears only once a student is in more
 * than one class, where it starts to mean something.
 */
export function StudentFeed({ items }: { items: StudentFeedItem[] }) {
  const [search, setSearch] = useState("");
  const [classes, setClasses] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<StudentFeedStatus>>(new Set());
  const [sort, setSort] = useState<FeedSortOption>("smart");

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
        sort,
        section
      );
      return { section, all, filtered };
    };
    return (["not_yet", "finished"] as const)
      .filter((section) => sectionSelected(section, statuses))
      .map(bucket);
  }, [items, filters, statuses, sort]);

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
              placeholder="לפי שם החידון, הסרטון, הכיתה או המורה"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {classOptions.length > 1 && (
            <MultiSelectDropdown
              label="כיתה"
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
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              נקה מסננים
            </Button>
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
          />
        ))}
      </div>
    </div>
  );
}

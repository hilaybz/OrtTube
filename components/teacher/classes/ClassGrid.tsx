"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Pager } from "@/components/ui/Pager";
import { usePagedList } from "@/components/ui/usePagedList";
import { matchesText } from "@/lib/libraryFilters";
import type { ClassRow } from "@/lib/classes";
import { LANGUAGE_LABELS } from "./labels";

/** Below this a search box is more chrome than help — the grid is scannable. */
const SEARCHABLE_FROM = 7;

/**
 * The teacher's classes as a grid of cards, searchable by name once there are
 * enough of them to be worth searching, and paged so a teacher with many
 * classes gets a fixed-height page rather than an ever-growing scroll.
 */
export function ClassGrid({ classes }: { classes: ClassRow[] }) {
  const [query, setQuery] = useState("");

  const visible = useMemo(
    () => classes.filter((c) => matchesText([c.name], query)),
    [classes, query]
  );
  const paged = usePagedList(visible, { pageSize: 9, resetKey: query });

  return (
    <div className="flex flex-col gap-5">
      {classes.length >= SEARCHABLE_FROM && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Field
              label="חיפוש כיתה"
              name="class-search"
              placeholder="לפי שם הכיתה"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {query !== "" && (
            <IconButton
              name="filterOff"
              label="ניקוי החיפוש"
              onClick={() => setQuery("")}
              className="mb-1"
            />
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <GlassCard>
          <p className="text-[var(--body)]">אין כיתה שתואמת את החיפוש.</p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {paged.slice.map((c) => (
            <Link
              key={c.id}
              href={`/dashboard/classes/${c.id}`}
              className="group block focus-visible:outline-none"
            >
              <GlassCard
                interactive
                className="flex h-full items-start justify-between gap-3"
              >
                <div className="flex min-w-0 flex-col gap-2">
                  <h2 className="truncate text-lg font-semibold text-[var(--heading)]">
                    {c.name}
                  </h2>
                  <Badge variant="gray">
                    <Icon name="class" size={12} />
                    {LANGUAGE_LABELS[c.language]}
                  </Badge>
                </div>
                <Icon
                  name="arrow"
                  size={18}
                  className="mt-1 shrink-0 text-[var(--fg-brand)]"
                />
              </GlassCard>
            </Link>
          ))}
        </div>
      )}

      <Pager {...paged} label="ניווט בין כיתות" />
    </div>
  );
}

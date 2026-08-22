"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/Tabs";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Spinner } from "@/components/ui/Spinner";
import { Alert } from "@/components/ui/Alert";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { Pager } from "@/components/ui/Pager";
import { usePagedList, type PagedList } from "@/components/ui/usePagedList";
import { apiFetch, ApiError } from "@/lib/http";
import type { MyQuiz } from "@/lib/quiz";
import type { SharedQuiz } from "@/lib/sharing";
import type { QuizAllocationTags } from "@/lib/allocations";
import type { ClassRow } from "@/lib/classes";
import type { Language } from "@/lib/lang";
import {
  sortQuizzes,
  matchesText,
  matchesClassFilter,
  matchesVisibility,
  UNASSIGNED_CLASS,
  SORT_LABELS,
  SORT_OPTIONS,
  VISIBILITY_SEGMENTS,
  type SortOption,
  type VisibilityFilter,
} from "@/lib/libraryFilters";
import { QuizCard, CatalogQuizCard, cardHeading, LANG_LABEL } from "@/components/teacher/QuizCard";
import { QuizPreviewModal } from "@/components/teacher/library/QuizPreviewModal";

type TabKey = "mine" | "school";

/** A 3-column grid, so a page is a whole number of rows. */
const PAGE_SIZE = 12;
const PAGE_SIZE_OPTIONS = [12, 24, 48] as const;

/**
 * The teacher quiz library: their own quizzes plus the same-school shared
 * catalog they can clone. Reads are done server-side (RLS) and handed in;
 * this component owns tab state and the clone mutation (POST /api/quizzes/share).
 *
 * Search/filter/sort live entirely client-side — neither `list_my_quizzes` nor
 * `list_shared_quizzes` paginates, so the full list is already here, and the
 * grid pages over the FILTERED result. Each tab keeps its OWN state (search
 * box, filters, sort); switching tabs never carries one tab's filtering into
 * the other.
 */
export function QuizLibrary({
  myQuizzes,
  sharedQuizzes,
  allocationTags,
  classes = [],
}: {
  myQuizzes: MyQuiz[];
  sharedQuizzes: SharedQuiz[];
  /** quiz_id → allocation tags, keyed for O(1) lookup per card. */
  allocationTags: Record<string, QuizAllocationTags>;
  /** The teacher's full class roster — options for the "My quizzes" class filter. */
  classes?: ClassRow[];
}) {
  const [tab, setTab] = useState<TabKey>("mine");

  return (
    <div className="flex flex-col gap-6">
      <Tabs<TabKey>
        ariaLabel="ספריית החידונים"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "mine", label: "שלי", icon: "book" },
          { value: "school", label: "מאגר בית הספר", icon: "users" },
        ]}
      />
      {tab === "mine" ? (
        <MineTab quizzes={myQuizzes} allocationTags={allocationTags} classes={classes} />
      ) : (
        <SchoolTab quizzes={sharedQuizzes} />
      )}
    </div>
  );
}

// ── Shared filter-bar pieces (both tabs) ────────────────────────────────────

const LANGUAGE_OPTIONS = (["he", "ar", "en"] as const satisfies readonly Language[]).map(
  (l) => ({ value: l, label: LANG_LABEL[l] })
);

/**
 * One glass strip: a wide search box, then the narrow filters, then the sort,
 * then a clear-filters icon that only exists while something is filtered — so
 * the bar's default state is a search box and nothing to dismiss.
 */
function FilterBar({
  children,
  dirty,
  onClear,
}: {
  children: React.ReactNode;
  dirty: boolean;
  onClear: () => void;
}) {
  return (
    <div className="glass flex flex-wrap items-end gap-3 p-4">
      {children}
      {dirty && (
        <IconButton
          name="filterOff"
          label="נקה מסננים"
          onClick={onClear}
          className="mb-0.5"
        />
      )}
    </div>
  );
}

/** The search box: a magnifier inside a label-less input, so the bar stays low. */
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex min-w-[220px] flex-1 flex-col gap-2">
      <span className="text-sm font-medium text-[var(--heading)]">חיפוש</span>
      <span className="relative flex items-center">
        <Icon
          name="search"
          size={16}
          className="pointer-events-none absolute start-3 text-[var(--body-subtle)]"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-[var(--radius)] border border-[var(--glass-border)] bg-[var(--glass-bg)] py-2.5 pe-3 ps-9 text-sm text-[var(--heading)] outline-none backdrop-blur-[20px] transition-colors placeholder:text-[var(--body-subtle)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
        />
      </span>
    </label>
  );
}

function LanguageFilter({
  selected,
  onChange,
}: {
  selected: Set<Language>;
  onChange: (next: Set<Language>) => void;
}) {
  return (
    <MultiSelectDropdown
      label="שפה"
      options={LANGUAGE_OPTIONS}
      selected={selected}
      onChange={onChange}
    />
  );
}

function SortSelect({
  value,
  onChange,
  name,
}: {
  value: SortOption;
  onChange: (v: SortOption) => void;
  name: string;
}) {
  return (
    <Select
      label="מיון"
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value as SortOption)}
    >
      {SORT_OPTIONS.map((opt) => (
        <option key={opt} value={opt}>
          {SORT_LABELS[opt]}
        </option>
      ))}
    </Select>
  );
}

/** Shown instead of the grid when filters/search narrow a non-empty list to zero. */
function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <GlassCard className="flex flex-col items-center gap-3 py-10 text-center">
      <Icon name="search" size={28} className="text-[var(--body-subtle)]" />
      <p className="text-[var(--body)]">אין חידונים התואמים את החיפוש.</p>
      <IconButton name="filterOff" label="נקה מסננים" onClick={onClear} />
    </GlassCard>
  );
}

/** The grid + its pager — one layout for both tabs. */
function QuizGrid({
  children,
  paged,
}: {
  children: React.ReactNode;
  paged: PagedList<unknown>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
      <Pager
        {...paged}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        label="ניווט בין חידונים"
      />
    </div>
  );
}

// ── Mine ─────────────────────────────────────────────────────────────────────

function MineTab({
  quizzes,
  allocationTags,
  classes,
}: {
  quizzes: MyQuiz[];
  allocationTags: Record<string, QuizAllocationTags>;
  classes: ClassRow[];
}) {
  const router = useRouter();
  const [pendingDelete, setPendingDelete] = useState<MyQuiz | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [languages, setLanguages] = useState<Set<Language>>(new Set());
  const [classFilter, setClassFilter] = useState<Set<string>>(new Set());
  const [visibility, setVisibility] = useState<VisibilityFilter>("all");
  const [sort, setSort] = useState<SortOption>("date_desc");

  const dirty =
    search !== "" ||
    languages.size > 0 ||
    classFilter.size > 0 ||
    visibility !== "all";

  function clearFilters() {
    setSearch("");
    setLanguages(new Set());
    setClassFilter(new Set());
    setVisibility("all");
  }

  const visibleQuizzes = useMemo(() => {
    const filtered = quizzes.filter(
      (q) =>
        matchesText([q.title, q.video_title, q.channel_name], search) &&
        (languages.size === 0 || languages.has(q.base_language)) &&
        matchesVisibility(visibility, q.visibility) &&
        matchesClassFilter(classFilter, allocationTags[q.quiz_id])
    );
    return sortQuizzes(filtered, sort);
  }, [quizzes, search, languages, visibility, classFilter, sort, allocationTags]);

  const paged = usePagedList(visibleQuizzes, {
    pageSize: PAGE_SIZE,
    resetKey: `${search}|${[...languages].sort().join()}|${[...classFilter].sort().join()}|${visibility}|${sort}`,
  });

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await apiFetch<null>(`/api/quizzes/${pendingDelete.quiz_id}`, {
        method: "DELETE",
      });
      setPendingDelete(null);
      // The list is a server read, so re-render it rather than mutating local state.
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "אירעה שגיאה. נסו שוב.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {error && <Alert variant="danger">{error}</Alert>}
      {quizzes.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 py-12 text-center">
          <Icon name="quiz" size={32} className="text-[var(--body-subtle)]" />
          <p className="text-[var(--body)]">
            עדיין לא יצרת חידונים. צרו חידון חדש כדי להתחיל.
          </p>
          <Link href="/dashboard/quizzes/new">
            <Button>
              <Icon name="plus" size={16} />
              חידון חדש
            </Button>
          </Link>
        </GlassCard>
      ) : (
        <>
          <FilterBar dirty={dirty} onClear={clearFilters}>
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="לפי כותרת, שם הסרטון או היוצר"
            />
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-[var(--heading)]">נראות</span>
              <SegmentedToggle<VisibilityFilter>
                segments={VISIBILITY_SEGMENTS}
                value={visibility}
                onChange={setVisibility}
                ariaLabel="נראות"
              />
            </div>
            <LanguageFilter selected={languages} onChange={setLanguages} />
            {classes.length > 0 && (
              <MultiSelectDropdown
                label="כיתה משויכת"
                options={[
                  ...classes.map((c) => ({ value: c.id, label: c.name })),
                  { value: UNASSIGNED_CLASS, label: "לא משויך" },
                ]}
                selected={classFilter}
                onChange={setClassFilter}
              />
            )}
            <SortSelect value={sort} onChange={setSort} name="mine-sort" />
          </FilterBar>
          {visibleQuizzes.length === 0 ? (
            <NoMatches onClear={clearFilters} />
          ) : (
            <QuizGrid paged={paged}>
              {paged.slice.map((q) => (
                <QuizCard
                  key={q.quiz_id}
                  quiz={q}
                  tags={allocationTags[q.quiz_id]}
                  onRequestDelete={setPendingDelete}
                />
              ))}
            </QuizGrid>
          )}
        </>
      )}

      <Modal
        open={pendingDelete !== null}
        title="מחיקת חידון"
        onClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
      >
        <p className="text-sm text-[var(--body)]">
          למחוק את &rdquo;{pendingDelete ? cardHeading(pendingDelete) : ""}&ldquo;?
          החידון ייעלם מהספרייה וממאגר בית הספר. תשובות ונתוני אנליטיקה של תלמידים
          שכבר פתרו אותו יישמרו.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => setPendingDelete(null)}
            disabled={deleting}
          >
            ביטול
          </Button>
          <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
            {deleting ? <Spinner size={16} /> : null}
            מחיקה
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ── School catalog ───────────────────────────────────────────────────────────

function SchoolTab({ quizzes }: { quizzes: SharedQuiz[] }) {
  const router = useRouter();
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewQuizId, setPreviewQuizId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [languages, setLanguages] = useState<Set<Language>>(new Set());
  const [sort, setSort] = useState<SortOption>("date_desc");

  const dirty = search !== "" || languages.size > 0;

  function clearFilters() {
    setSearch("");
    setLanguages(new Set());
  }

  const visibleQuizzes = useMemo(() => {
    const filtered = quizzes.filter(
      (q) =>
        matchesText([q.title, q.video_title, q.channel_name, q.author_name], search) &&
        (languages.size === 0 || languages.has(q.base_language))
    );
    return sortQuizzes(filtered, sort);
  }, [quizzes, search, languages, sort]);

  const paged = usePagedList(visibleQuizzes, {
    pageSize: PAGE_SIZE,
    resetKey: `${search}|${[...languages].sort().join()}|${sort}`,
  });

  async function clone(sourceQuizId: string) {
    setCloningId(sourceQuizId);
    setError(null);
    try {
      const { quizId } = await apiFetch<{ quizId: string }>(
        "/api/quizzes/share",
        { method: "POST", body: JSON.stringify({ sourceQuizId }) }
      );
      router.push(`/dashboard/quizzes/${quizId}/edit`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "אירעה שגיאה. נסו שוב.");
      setCloningId(null);
    }
  }

  if (quizzes.length === 0) {
    return (
      <GlassCard className="flex flex-col items-center gap-3 py-12 text-center">
        <Icon name="users" size={32} className="text-[var(--body-subtle)]" />
        <p className="text-[var(--body)]">אין עדיין חידונים משותפים בבית הספר שלך.</p>
      </GlassCard>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {error && <Alert variant="danger">{error}</Alert>}
      <FilterBar dirty={dirty} onClear={clearFilters}>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="לפי כותרת, שם הסרטון, היוצר או שם המורה"
        />
        <LanguageFilter selected={languages} onChange={setLanguages} />
        <SortSelect value={sort} onChange={setSort} name="school-sort" />
      </FilterBar>
      {visibleQuizzes.length === 0 ? (
        <NoMatches onClear={clearFilters} />
      ) : (
        <QuizGrid paged={paged}>
          {paged.slice.map((q) => (
            <CatalogQuizCard
              key={q.quiz_id}
              quiz={q}
              onPreview={setPreviewQuizId}
              onClone={clone}
              cloning={cloningId === q.quiz_id}
              cloneDisabled={cloningId !== null && cloningId !== q.quiz_id}
            />
          ))}
        </QuizGrid>
      )}

      <QuizPreviewModal
        // A fresh instance per quiz, so switching preview targets can never
        // paint a frame of the PREVIOUS quiz's content (answer key included)
        // under a modal opened for a different one.
        key={previewQuizId ?? "none"}
        open={previewQuizId != null}
        quizId={previewQuizId ?? ""}
        onClose={() => setPreviewQuizId(null)}
        onClone={clone}
        cloning={cloningId !== null}
      />
    </div>
  );
}

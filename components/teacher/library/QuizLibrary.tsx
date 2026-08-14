"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/Tabs";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { Alert } from "@/components/ui/Alert";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
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
  UNASSIGNED_CLASS,
  SORT_LABELS,
  SORT_OPTIONS,
  type SortOption,
} from "@/lib/libraryFilters";
import {
  QuizCard,
  cardHeading,
  VideoLine,
  QuizMeta,
  ChannelLine,
  LANG_LABEL,
} from "@/components/teacher/QuizCard";

type TabKey = "mine" | "school";

/**
 * The teacher quiz library: their own quizzes plus the same-school shared
 * catalog they can clone. Reads are done server-side (RLS) and handed in;
 * this component owns tab state and the clone mutation (POST /api/quizzes/share).
 *
 * Search/filter/sort (backlog 1.4) live entirely client-side — neither
 * `list_my_quizzes` nor `list_shared_quizzes` paginates, so the full list is
 * already here. Each tab keeps its OWN state (search box, filters, sort);
 * switching tabs never carries one tab's filtering into the other.
 */
export function QuizLibrary({
  myQuizzes,
  sharedQuizzes,
  allocationTags,
  classes = [],
}: {
  myQuizzes: MyQuiz[];
  sharedQuizzes: SharedQuiz[];
  /** quiz_id → allocation tags (backlog 1.5), keyed for O(1) lookup per card. */
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

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

const ALL_LANGUAGES: Language[] = ["he", "ar", "en"];

function LanguageFilter({
  selected,
  onToggle,
}: {
  selected: Set<Language>;
  onToggle: (l: Language) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-[var(--heading)]">שפה</span>
      <div role="group" aria-label="סינון לפי שפה" className="flex flex-wrap gap-2">
        {ALL_LANGUAGES.map((l) => (
          <Pill key={l} active={selected.has(l)} onClick={() => onToggle(l)}>
            {LANG_LABEL[l]}
          </Pill>
        ))}
      </div>
    </div>
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
    <GlassCard className="flex flex-col items-start gap-3">
      <p className="text-[var(--body)]">אין חידונים התואמים את החיפוש.</p>
      <Button variant="ghost" size="sm" onClick={onClear}>
        נקה מסננים
      </Button>
    </GlassCard>
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
  const [sort, setSort] = useState<SortOption>("date_desc");

  function clearFilters() {
    setSearch("");
    setLanguages(new Set());
    setClassFilter(new Set());
  }

  const visibleQuizzes = useMemo(() => {
    const filtered = quizzes.filter(
      (q) =>
        matchesText([q.title, q.video_title, q.channel_name], search) &&
        (languages.size === 0 || languages.has(q.base_language)) &&
        matchesClassFilter(classFilter, allocationTags[q.quiz_id])
    );
    return sortQuizzes(filtered, sort);
  }, [quizzes, search, languages, classFilter, sort, allocationTags]);

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
      <div className="flex justify-end">
        <Link href="/dashboard/quizzes/new">
          <Button>
            <Icon name="sparkle" size={16} />
            חידון חדש
          </Button>
        </Link>
      </div>
      {error && <Alert variant="danger">{error}</Alert>}
      {quizzes.length === 0 ? (
        <GlassCard>
          <p className="text-[var(--body)]">
            עדיין לא יצרת חידונים. צרו חידון חדש כדי להתחיל.
          </p>
        </GlassCard>
      ) : (
        <>
          <GlassCard className="flex flex-wrap items-end gap-4">
            <div className="min-w-[220px] flex-1">
              <Field
                label="חיפוש"
                name="mine-search"
                placeholder="לפי כותרת, שם הסרטון או היוצר"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <LanguageFilter
              selected={languages}
              onToggle={(l) => setLanguages((prev) => toggleInSet(prev, l))}
            />
            {classes.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-[var(--heading)]">
                  כיתה משויכת
                </span>
                <div
                  role="group"
                  aria-label="סינון לפי כיתה"
                  className="flex flex-wrap gap-2"
                >
                  {classes.map((c) => (
                    <Pill
                      key={c.id}
                      active={classFilter.has(c.id)}
                      onClick={() => setClassFilter((prev) => toggleInSet(prev, c.id))}
                    >
                      {c.name}
                    </Pill>
                  ))}
                  <Pill
                    active={classFilter.has(UNASSIGNED_CLASS)}
                    onClick={() =>
                      setClassFilter((prev) => toggleInSet(prev, UNASSIGNED_CLASS))
                    }
                  >
                    לא משויך
                  </Pill>
                </div>
              </div>
            )}
            <SortSelect value={sort} onChange={setSort} name="mine-sort" />
          </GlassCard>
          {visibleQuizzes.length === 0 ? (
            <NoMatches onClear={clearFilters} />
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {visibleQuizzes.map((q) => (
                <QuizCard
                  key={q.quiz_id}
                  quiz={q}
                  tags={allocationTags[q.quiz_id]}
                  onRequestDelete={setPendingDelete}
                />
              ))}
            </div>
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

  const [search, setSearch] = useState("");
  const [languages, setLanguages] = useState<Set<Language>>(new Set());
  const [sort, setSort] = useState<SortOption>("date_desc");

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
      <GlassCard>
        <p className="text-[var(--body)]">
          אין עדיין חידונים משותפים בבית הספר שלך.
        </p>
      </GlassCard>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {error && <Alert variant="danger">{error}</Alert>}
      <GlassCard className="flex flex-wrap items-end gap-4">
        <div className="min-w-[220px] flex-1">
          <Field
            label="חיפוש"
            name="school-search"
            placeholder="לפי כותרת, שם הסרטון, היוצר או שם המורה"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <LanguageFilter
          selected={languages}
          onToggle={(l) => setLanguages((prev) => toggleInSet(prev, l))}
        />
        <SortSelect value={sort} onChange={setSort} name="school-sort" />
      </GlassCard>
      {visibleQuizzes.length === 0 ? (
        <NoMatches onClear={clearFilters} />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visibleQuizzes.map((q) => {
            const busy = cloningId === q.quiz_id;
            return (
              <GlassCard key={q.quiz_id} className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-[var(--heading)]">
                    {cardHeading(q)}
                  </h3>
                  {q.is_own && <Badge variant="brand">שלי</Badge>}
                </div>
                <VideoLine quiz={q} />
                <ChannelLine channelName={q.channel_name} />
                {q.author_name && (
                  <p className="text-xs text-[var(--body-subtle)]">
                    מאת {q.author_name}
                  </p>
                )}
                <QuizMeta
                  baseLanguage={q.base_language}
                  questionCount={q.question_count}
                />
                <div className="mt-auto pt-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => clone(q.quiz_id)}
                    disabled={cloningId !== null}
                  >
                    {busy ? <Spinner size={16} /> : <Icon name="grid" size={16} />}
                    שכפול
                  </Button>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

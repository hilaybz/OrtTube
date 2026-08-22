"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconButton, IconLink } from "@/components/ui/IconButton";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { Pager } from "@/components/ui/Pager";
import { usePagedList } from "@/components/ui/usePagedList";
import { Spinner } from "@/components/ui/Spinner";
import { apiFetch, ApiError } from "@/lib/http";
import { matchesText } from "@/lib/libraryFilters";
import type { AssignedQuiz, TutorMode } from "@/lib/classes";
import { allocationState, type AllocationState } from "@/lib/allocationState";
import type { MyQuiz } from "@/lib/quiz";
import { TUTOR_MODE_LABELS } from "./labels";
import { classQuizAnalyticsHref } from "../analyticsLinks";
import { AllocationEditModal } from "./AllocationEditModal";
import { QuizPreviewModal } from "@/components/teacher/library/QuizPreviewModal";
import { EndQuizConfirmModal } from "@/components/teacher/EndQuizConfirmModal";
import {
  allocationStatus,
  fromDatetimeLocalValue,
} from "@/components/teacher/scheduleFormat";

/**
 * The lifecycle sections, in display order. Open work comes first and the
 * hidden ones sink to the bottom, since a quiz students can't see is the one a
 * teacher is least likely to be looking for.
 */
const SECTION_ORDER: AllocationState[] = ["live", "scheduled", "done", "draft"];

/**
 * How each section reads. A coloured rail down the inline start plus a heading
 * in the same colour groups the rows without tinting the glass. Colour follows
 * availability: open work is green (students can reach it right now), scheduled
 * is amber (it hasn't started), ended is neutral gray (it's settled and closed).
 *
 * Hidden rows share that neutral gray but draw the rail as a broken line and
 * carry an eye-off glyph in the heading, because gray alone can't tell "closed"
 * from "never shown". They also sit last and render dimmed: quizzes withdrawn
 * from students aren't a phase of the lifecycle a teacher works through, they
 * are rows parked to one side (and they get no analytics — nobody took them).
 */
const SECTION_STYLE: Record<
  AllocationState,
  { title: string; icon?: IconName; frame: string; heading: string }
> = {
  live: {
    title: "פעילים",
    frame: "border-s-2 border-s-[var(--fg-success)] ps-4",
    heading: "text-[var(--fg-success)]",
  },
  scheduled: {
    title: "מתוזמנים",
    frame: "border-s-2 border-s-[var(--fg-warning)] ps-4",
    heading: "text-[var(--fg-warning)]",
  },
  done: {
    title: "הסתיימו",
    frame: "border-s-2 border-s-[var(--gray)] ps-4",
    heading: "text-[var(--body)]",
  },
  draft: {
    title: "מוסתרים",
    icon: "eyeOff",
    frame: "border-s-2 border-dashed border-s-[var(--gray)] ps-4",
    heading: "text-[var(--body-subtle)]",
  },
};

/** The things a teacher asks of this list. */
type QuizFilter = "all" | "active" | "done" | "hidden";

const FILTER_SEGMENTS = [
  { value: "all", label: "הכול" },
  { value: "active", label: "פעילים" },
  { value: "done", label: "הסתיימו" },
  { value: "hidden", label: "מוסתרים" },
] as const;

/** Which lifecycle sections a filter admits. */
export function sectionInFilter(state: AllocationState, filter: QuizFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return state === "live";
    case "done":
      return state === "done";
    case "hidden":
      return state === "draft";
  }
}

/**
 * Sort key per section — soonest-relevant-date first, so a teacher scanning
 * the list sees what needs attention soonest at the top of each group.
 * No-date items sink to the end rather than sorting arbitrarily.
 */
function sectionSortValue(state: AllocationState, a: AssignedQuiz): number {
  switch (state) {
    case "live":
      return a.available_until ? new Date(a.available_until).getTime() : Infinity;
    case "scheduled":
      return a.available_from ? new Date(a.available_from).getTime() : Infinity;
    case "done":
      // Most-recently-closed first.
      return a.available_until ? -new Date(a.available_until).getTime() : Infinity;
    case "draft":
      // Newest-assigned first.
      return -new Date(a.assigned_at).getTime();
  }
}

/**
 * Buckets assigned quizzes into their four lifecycle sections and sorts each
 * — pure, so it's unit-testable without a DOM (mirrors
 * `sortFeed` in `lib/studentFeedFilters.ts`).
 * Does not mutate `assigned`.
 */
export function groupAssignedByState(
  assigned: AssignedQuiz[],
  now: Date = new Date()
): Record<AllocationState, AssignedQuiz[]> {
  const groups: Record<AllocationState, AssignedQuiz[]> = {
    draft: [],
    live: [],
    scheduled: [],
    done: [],
  };
  for (const a of assigned) {
    groups[allocationState(a, now)].push(a);
  }
  for (const state of SECTION_ORDER) {
    groups[state] = [...groups[state]].sort(
      (a, b) => sectionSortValue(state, a) - sectionSortValue(state, b)
    );
  }
  return groups;
}

/** The text a row is titled by, and searched by. */
function headingOf(a: AssignedQuiz): string {
  return a.title ?? a.video_title ?? "חידון";
}

/**
 * Assigned-quizzes management for a class: a search box and an
 * all/active/ended filter over four lifecycle sections, each paged, with
 * icon-only row actions (analytics, edit, show/hide, end now, unassign) and an
 * "assign" modal that picks from the teacher's own quizzes and sets
 * `tutorMode` + `maxAttempts` + `published` + an optional scheduling window.
 * Mutations round-trip through `apiFetch` + `router.refresh()`.
 *
 * Each row is itself a stretched link: it opens the quiz editor for a quiz
 * this teacher authored, or a read-only preview for an assigned `shared` quiz
 * someone else wrote (the editor would just reject them as `not_owner`).
 */
export function AssignedQuizzesSection({
  classId,
  assigned,
  myQuizzes,
}: {
  classId: string;
  assigned: AssignedQuiz[];
  myQuizzes: MyQuiz[];
}) {
  const router = useRouter();

  // One instant for the whole render, so every row's state and countdown agree
  // with each other and with the section they were sorted into.
  const [now] = useState(() => new Date());

  // Only quizzes not already assigned to this class are assignable.
  const available = useMemo(() => {
    const taken = new Set(assigned.map((a) => a.quiz_id));
    return myQuizzes.filter((q) => !taken.has(q.quiz_id));
  }, [assigned, myQuizzes]);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<QuizFilter>("all");

  // Search narrows the rows; the filter narrows the sections. Searching first
  // means a hit is never hidden behind a page boundary.
  const matched = useMemo(
    () =>
      assigned.filter((a) =>
        matchesText([a.title, a.video_title, a.author_name], query)
      ),
    [assigned, query]
  );
  const sections = useMemo(() => groupAssignedByState(matched, now), [matched, now]);
  const visibleSections = SECTION_ORDER.filter(
    (state) => sectionInFilter(state, filter) && sections[state].length > 0
  );
  const narrowed = query !== "" || filter !== "all";

  const [open, setOpen] = useState(false);
  const [quizId, setQuizId] = useState("");
  const [tutorMode, setTutorMode] = useState<TutorMode>("hints");
  const [unlimited, setUnlimited] = useState(false);
  const [maxAttempts, setMaxAttempts] = useState("1");
  const [publishNow, setPublishNow] = useState(true);
  const [availableFrom, setAvailableFrom] = useState("");
  const [availableUntil, setAvailableUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [pending, setPending] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");

  // Read-only preview for an assigned shared quiz this teacher didn't author.
  const [previewQuizId, setPreviewQuizId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AssignedQuiz | null>(null);
  // The row awaiting unassign confirmation — destructive, so it asks first.
  const [unassigning, setUnassigning] = useState<AssignedQuiz | null>(null);

  // The row awaiting "end quiz now" confirmation (null = modal closed). Ending
  // gets its own shared modal (`EndQuizConfirmModal`) because the editor's
  // allocation rows ask the same question and the wording must not drift.
  const [endConfirm, setEndConfirm] = useState<AssignedQuiz | null>(null);

  function openAssign() {
    setQuizId(available[0]?.quiz_id ?? "");
    setTutorMode("hints");
    setUnlimited(false);
    setMaxAttempts("1");
    setPublishNow(true);
    setAvailableFrom("");
    setAvailableUntil("");
    setError("");
    setOpen(true);
  }

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    if (!quizId) {
      setError("יש לבחור חידון.");
      return;
    }
    let attempts: number | null = null;
    if (!unlimited) {
      const n = Number(maxAttempts);
      if (!Number.isInteger(n) || n < 1) {
        setError("מספר הניסיונות חייב להיות מספר שלם גדול מ־0.");
        return;
      }
      attempts = n;
    }
    const from = fromDatetimeLocalValue(availableFrom);
    const until = fromDatetimeLocalValue(availableUntil);
    if (from && until && from >= until) {
      setError("תחילת הזמינות חייבת להיות לפני סיומה.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/classes/${classId}/quizzes`, {
        method: "POST",
        body: JSON.stringify({
          quizId,
          tutorMode,
          maxAttempts: attempts,
          published: publishNow,
          availableFrom: from,
          availableUntil: until,
        }),
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "הקצאת החידון נכשלה.");
    } finally {
      setBusy(false);
    }
  }

  /** Runs one row mutation with that row's spinner and error surface. */
  async function rowAction(
    id: string,
    failure: string,
    run: () => Promise<unknown>
  ) {
    setPending(id);
    setRowError("");
    try {
      await run();
      router.refresh();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : failure);
    } finally {
      setPending(null);
    }
  }

  function unassign(a: AssignedQuiz) {
    return rowAction(a.quiz_id, "ביטול ההקצאה נכשל.", () =>
      apiFetch(`/api/classes/${classId}/quizzes/${a.quiz_id}`, { method: "DELETE" })
    );
  }

  function togglePublished(a: AssignedQuiz) {
    return rowAction(a.quiz_id, "עדכון הצגת החידון נכשל.", () =>
      apiFetch(`/api/classes/${classId}/quizzes/${a.quiz_id}`, {
        method: "PATCH",
        body: JSON.stringify({ published: !a.published }),
      })
    );
  }

  /**
   * End an open quiz now: move its closing bound to this instant. The window is
   * replaced as a whole (the RPC has no partial update), so the opening bound
   * is resent unchanged.
   */
  function endNow(a: AssignedQuiz) {
    return rowAction(a.quiz_id, "סיום השאלון נכשל.", () =>
      apiFetch(`/api/classes/${classId}/quizzes/${a.quiz_id}`, {
        method: "PATCH",
        body: JSON.stringify({
          availableFrom: a.available_from,
          availableUntil: new Date().toISOString(),
        }),
      })
    );
  }

  async function confirmUnassign() {
    const target = unassigning;
    if (!target) return;
    setUnassigning(null);
    await unassign(target);
  }

  async function confirmEnd() {
    const target = endConfirm;
    if (!target) return;
    setEndConfirm(null);
    await endNow(target);
  }

  /**
   * Reopens an ended assignment, open-ended: clears `available_until` while
   * resending the opening bound, since the RPC replaces the window as a whole.
   */
  function reopen(a: AssignedQuiz) {
    return rowAction(a.quiz_id, "פתיחת השאלון נכשלה.", () =>
      apiFetch(`/api/classes/${classId}/quizzes/${a.quiz_id}`, {
        method: "PATCH",
        body: JSON.stringify({
          availableFrom: a.available_from,
          availableUntil: null,
        }),
      })
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-[var(--heading)]">
            חידונים מוקצים
          </h3>
          <Badge variant="gray">
            <span className="tabular-nums">{assigned.length}</span>
          </Badge>
        </div>
        <IconButton
          name="plus"
          label="הקצאת חידון"
          variant="brand"
          onClick={openAssign}
          disabled={available.length === 0}
          tooltipPlacement="bottom"
        />
      </div>

      {rowError && (
        <Alert variant="danger" title="שגיאה">
          {rowError}
        </Alert>
      )}

      {available.length === 0 && myQuizzes.length > 0 && assigned.length > 0 && (
        <p className="text-sm text-[var(--body-subtle)]">
          כל החידונים שלך כבר מוקצים לכיתה זו.
        </p>
      )}

      {assigned.length === 0 ? (
        <div className="glass p-5">
          {myQuizzes.length === 0 ? (
            <p className="text-[var(--body)]">
              אין לך עדיין חידונים.{" "}
              <Link
                href="/dashboard/quizzes"
                className="font-medium text-[var(--fg-brand)] underline hover:no-underline"
              >
                צרו חידון
              </Link>{" "}
              כדי להקצות אותו לכיתה.
            </p>
          ) : (
            <p className="text-[var(--body)]">
              עדיין לא הוקצו חידונים לכיתה זו. הוסיפו חידון בעזרת הכפתור למעלה.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <Field
                label="חיפוש חידון"
                name="assigned-search"
                placeholder="לפי שם החידון, הסרטון או המחבר"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <SegmentedToggle
              ariaLabel="סינון לפי מצב"
              segments={FILTER_SEGMENTS}
              value={filter}
              onChange={setFilter}
              className="mb-1"
            />
            {narrowed && (
              <IconButton
                name="filterOff"
                label="ניקוי החיפוש והסינון"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
                className="mb-1"
              />
            )}
          </div>

          {visibleSections.length === 0 ? (
            <div className="glass p-5">
              <p className="text-[var(--body)]">
                אין חידון שתואם את החיפוש או הסינון.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {visibleSections.map((state) => (
                <AllocationSection
                  key={state}
                  classId={classId}
                  state={state}
                  rows={sections[state]}
                  now={now}
                  pending={pending}
                  onEdit={setEditing}
                  onTogglePublished={togglePublished}
                  onPreview={setPreviewQuizId}
                  onRequestEnd={setEndConfirm}
                  onRequestUnassign={setUnassigning}
                  onReopen={reopen}
                />
              ))}
            </div>
          )}
        </>
      )}

      <QuizPreviewModal
        key={previewQuizId ?? "none"}
        open={previewQuizId !== null}
        quizId={previewQuizId ?? ""}
        onClose={() => setPreviewQuizId(null)}
      />

      <AllocationEditModal
        classId={classId}
        allocation={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />

      <EndQuizConfirmModal
        open={endConfirm !== null}
        prompt={
          <>
            לסיים את &rdquo;{endConfirm ? headingOf(endConfirm) : "החידון"}&ldquo; עכשיו
            לכל הכיתה?
          </>
        }
        busy={endConfirm !== null && pending === endConfirm.quiz_id}
        onConfirm={confirmEnd}
        onClose={() => setEndConfirm(null)}
      />

      <Modal
        open={unassigning !== null}
        onClose={() => setUnassigning(null)}
        title="ביטול הקצאה"
      >
        <div className="flex flex-col gap-4">
          <p className="text-[var(--body)]">
            {`לבטל את ההקצאה של "${unassigning ? headingOf(unassigning) : ""}"? החידון יוסר מהכיתה; ניסיונות שהוגשו יישמרו.`}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setUnassigning(null)}>
              חזרה
            </Button>
            <Button type="button" variant="danger" onClick={confirmUnassign}>
              ביטול הקצאה
            </Button>
          </div>
        </div>
      </Modal>


      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="הקצאת חידון"
      >
        <form onSubmit={assign} className="flex flex-col gap-4">
          {error && (
            <Alert variant="danger" title="לא ניתן להקצות">
              {error}
            </Alert>
          )}

          {available.length === 0 ? (
            <p className="text-[var(--body)]">
              אין חידונים זמינים להקצאה.
            </p>
          ) : (
            <>
              <Select
                label="חידון"
                name="quizId"
                value={quizId}
                onChange={(e) => setQuizId(e.target.value)}
              >
                {available.map((q) => (
                  <option key={q.quiz_id} value={q.quiz_id}>
                    {q.title ?? q.video_title ?? "חידון ללא כותרת"}
                  </option>
                ))}
              </Select>

              <Select
                label="מצב מורה־AI"
                name="tutorMode"
                value={tutorMode}
                onChange={(e) => setTutorMode(e.target.value as TutorMode)}
              >
                {(Object.keys(TUTOR_MODE_LABELS) as TutorMode[]).map((m) => (
                  <option key={m} value={m}>
                    {TUTOR_MODE_LABELS[m]}
                  </option>
                ))}
              </Select>

              <div className="flex flex-col gap-3">
                <Field
                  label="מספר ניסיונות מרבי"
                  name="maxAttempts"
                  type="number"
                  min={1}
                  step={1}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(e.target.value)}
                  disabled={unlimited}
                />
                <label className="flex items-center gap-2 text-sm text-[var(--body)]">
                  <input
                    type="checkbox"
                    checked={unlimited}
                    onChange={(e) => setUnlimited(e.target.checked)}
                    className="h-4 w-4 rounded-[var(--radius-sm)] border border-[var(--glass-border)] accent-[var(--brand)]"
                  />
                  ניסיונות ללא הגבלה
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--body)]">
                  <input
                    type="checkbox"
                    checked={publishNow}
                    onChange={(e) => setPublishNow(e.target.checked)}
                    className="h-4 w-4 rounded-[var(--radius-sm)] border border-[var(--glass-border)] accent-[var(--brand)]"
                  />
                  פרסום מיידי לתלמידים
                </label>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Field
                  label="זמין החל מ־ (אופציונלי)"
                  name="availableFrom"
                  type="datetime-local"
                  value={availableFrom}
                  onChange={(e) => setAvailableFrom(e.target.value)}
                />
                <Field
                  label="זמין עד (אופציונלי)"
                  name="availableUntil"
                  type="datetime-local"
                  value={availableUntil}
                  onChange={(e) => setAvailableUntil(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              ביטול
            </Button>
            <Button type="submit" disabled={busy || available.length === 0}>
              {busy && <Spinner size={16} />}
              הקצאה
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/**
 * One lifecycle section: its heading, its rows, and its own pager — each
 * section pages independently so a long list of ended quizzes never pushes the
 * open ones off the screen.
 */
function AllocationSection({
  classId,
  state,
  rows,
  now,
  pending,
  onEdit,
  onTogglePublished,
  onPreview,
  onRequestEnd,
  onRequestUnassign,
  onReopen,
}: {
  classId: string;
  state: AllocationState;
  rows: AssignedQuiz[];
  now: Date;
  pending: string | null;
  onEdit: (a: AssignedQuiz) => void;
  onTogglePublished: (a: AssignedQuiz) => void;
  onPreview: (quizId: string) => void;
  onRequestEnd: (a: AssignedQuiz) => void;
  onRequestUnassign: (a: AssignedQuiz) => void;
  onReopen: (a: AssignedQuiz) => void;
}) {
  const style = SECTION_STYLE[state];
  const paged = usePagedList(rows, { resetKey: state });

  return (
    <section className={`flex flex-col gap-3 ${style.frame}`}>
      <div className="flex items-center gap-2">
        <h4
          className={`flex items-center gap-1.5 text-sm font-semibold ${style.heading}`}
        >
          {style.icon && <Icon name={style.icon} size={14} />}
          {style.title}
        </h4>
        <Badge variant="gray">
          <span className="tabular-nums">{rows.length}</span>
        </Badge>
      </div>
      <ul className={`flex flex-col gap-3 ${state === "draft" ? "opacity-60" : ""}`}>
        {paged.slice.map((a) => (
          <AssignedQuizRow
            key={a.quiz_id}
            classId={classId}
            allocation={a}
            now={now}
            busy={pending === a.quiz_id}
            onEdit={() => onEdit(a)}
            onTogglePublished={() => onTogglePublished(a)}
            onPreview={() => onPreview(a.quiz_id)}
            onEndNow={() => onRequestEnd(a)}
            onUnassign={() => onRequestUnassign(a)}
            onReopen={() => onReopen(a)}
          />
        ))}
      </ul>
      <Pager {...paged} label="ניווט בין חידונים" />
    </section>
  );
}

/**
 * One assignment row. Clickable via the stretched-link pattern (precedent:
 * `components/teacher/QuizCard.tsx`): a `Link`/button absolutely fills the
 * row, the visible content sits above it lifted to `z-20 pointer-events-none`
 * (the whole wrapper, not just a button — `.glass > *` in globals.css pins
 * every direct child to `z-index: 2`, so a lower z-index on one control alone
 * would stay trapped beneath that stacking context), and the action cluster
 * opts back in with `pointer-events-auto`.
 *
 * `allocation.is_own` decides the destination: your own quiz opens the
 * editor; an assigned shared quiz someone else authored opens the read-only
 * preview instead of dead-ending on the editor's "not yours" page.
 *
 * The row carries ONE status chip — a sentence, not a state noun, so it needs
 * no date range beside it to be understood — plus the facts a teacher chooses
 * an assignment by. Everything else about the allocation lives one click away
 * in the edit modal.
 */
function AssignedQuizRow({
  classId,
  allocation: a,
  now,
  busy,
  onEdit,
  onTogglePublished,
  onPreview,
  onEndNow,
  onUnassign,
  onReopen,
}: {
  classId: string;
  allocation: AssignedQuiz;
  now: Date;
  busy: boolean;
  onEdit: () => void;
  onTogglePublished: () => void;
  onPreview: () => void;
  onEndNow: () => void;
  onUnassign: () => void;
  onReopen: () => void;
}) {
  const heading = headingOf(a);
  const status = allocationStatus(a, now);
  const showAnalytics = status.state === "live" || status.state === "done";

  return (
    <li className="glass relative p-4">
      {a.is_own ? (
        <Link
          href={`/dashboard/quizzes/${a.quiz_id}/edit`}
          aria-label={`עריכת ${heading}`}
          className="absolute inset-0 z-10 rounded-[inherit]"
        />
      ) : (
        <button
          type="button"
          onClick={onPreview}
          aria-label={`תצוגה מקדימה של ${heading}`}
          className="absolute inset-0 z-10 rounded-[inherit]"
        />
      )}
      <div className="pointer-events-none relative z-20 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://i.ytimg.com/vi/${a.youtube_video_id}/mqdefault.jpg`}
            alt=""
            className="aspect-video w-24 shrink-0 rounded-[var(--radius-sm)] bg-black object-cover"
          />
          <div className="flex min-w-0 flex-col gap-2">
            <h4 className="truncate font-semibold text-[var(--heading)]">
              {heading}
            </h4>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status.variant}>
                <Icon name={status.icon} size={12} />
                {/* Relative to the moment the page rendered, so the server's
                    first paint and the client's hydration can word it
                    differently across a boundary. */}
                <span suppressHydrationWarning>{status.label}</span>
              </Badge>
              <Badge variant="gray">
                <span className="tabular-nums">{a.question_count}</span> שאלות
              </Badge>
              <Badge variant="brand">
                מורה־AI: {TUTOR_MODE_LABELS[a.tutor_mode]}
              </Badge>
              {!a.is_own && (
                <Badge variant="gray">
                  {a.author_name ? `מאת ${a.author_name}` : "משותף"}
                </Badge>
              )}
            </div>
          </div>
        </div>
        {/* The whole action cluster opts back into pointer events, tooltip
            wrappers included, so hovering an icon still explains it. */}
        <div className="pointer-events-auto flex items-center gap-1">
          {showAnalytics && (
            <IconLink
              name="chart"
              label="אנליטיקה של החידון בכיתה"
              href={classQuizAnalyticsHref(classId, a.quiz_id)}
              size="sm"
            />
          )}
          <IconButton
            name="edit"
            label="עריכת ההקצאה"
            size="sm"
            disabled={busy}
            onClick={onEdit}
          />
          {/* An ended assignment has nothing to publish — reopening it is the
              one thing a teacher wants from that row instead. */}
          {status.state === "done" ? (
            <IconButton
              name="replay"
              label="פתיחת השאלון מחדש לכיתה"
              size="sm"
              busy={busy}
              onClick={onReopen}
            />
          ) : (
            <IconButton
              name={a.published ? "eyeOff" : "eye"}
              label={a.published ? "הסתרה מתלמידים" : "הצגה לתלמידים"}
              size="sm"
              busy={busy}
              onClick={onTogglePublished}
            />
          )}
          {status.state === "live" && (
            <IconButton
              name="checkCircle"
              label="סיום השאלון עכשיו"
              size="sm"
              disabled={busy}
              onClick={onEndNow}
            />
          )}
          <IconButton
            name="trash"
            label="ביטול הקצאה"
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={onUnassign}
          />
        </div>
      </div>
    </li>
  );
}

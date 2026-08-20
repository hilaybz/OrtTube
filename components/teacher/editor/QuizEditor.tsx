"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Pager } from "@/components/ui/Pager";
import { usePagedList } from "@/components/ui/usePagedList";
import { SegmentedToggle, type Segment } from "@/components/ui/SegmentedToggle";
import type {
  GenerationDifficulty,
  OptionsPerQuestion,
  QuestionType,
} from "@/lib/ai/generationOptions";
import type { Language } from "@/lib/lang";
import { apiFetch, ApiError } from "@/lib/http";
import type { AuthorQuestion, AuthorQuiz, QuizVisibility } from "@/lib/quizAuthor";
import type { ClassRow } from "@/lib/classes";
import type { QuizAllocation } from "@/lib/allocations";
import { estimateQuizMinutes } from "@/lib/quizDuration";
import { QuestionModal } from "./QuestionModal";
import { AllocationsSection } from "./AllocationsSection";
import { VideoPreviewPanel, type VideoPreviewPanelHandle } from "./VideoPreviewPanel";
import { QuestionListItem } from "./QuestionListItem";
import { updateQuizMeta, deleteQuestion, MutationError } from "./mutations";
import { LANGUAGE_LABELS, formatTime } from "./format";

// How long a marker-click highlight lingers on the matching question card.
const HIGHLIGHT_MS = 1600;

// The quiz's own two states, shown as the choice itself rather than as a
// labelled "נראות" field — the two labels say what they mean.
const VISIBILITY_SEGMENTS: ReadonlyArray<Segment<QuizVisibility>> = [
  { value: "private", label: "פרטי" },
  { value: "shared", label: "משותף לביה\u05f4ס" },
];

// How a quiz's length is decided: estimated from the video (the default, shown
// to students with a `~`) or a minute count the teacher states outright.
type DurationMode = "estimated" | "restricted";
const DURATION_SEGMENTS: ReadonlyArray<Segment<DurationMode>> = [
  { value: "estimated", label: "הערכה מהסרטון" },
  { value: "restricted", label: "הגבלת זמן" },
];

// A quiz can accumulate questions indefinitely (each AI run adds up to 20), so
// the list pages. The timeline above it always shows every marker, and picking
// one jumps to the page its question is on.
const QUESTIONS_PAGE_SIZE = 8;

// The generate RPC accepts 1–20; keep the UI bounds in lockstep with it.
const GEN_COUNT_MIN = 1;
const GEN_COUNT_MAX = 20;
const GEN_COUNT_DEFAULT = 5;

// Mirrors the server's difficulty enum exactly — the UI must neither narrow what
// the backend accepts nor offer a value it would reject.
const DIFFICULTY_SEGMENTS: ReadonlyArray<Segment<GenerationDifficulty>> = [
  { value: "easy", label: "קל" },
  { value: "medium", label: "בינוני" },
  { value: "hard", label: "מאתגר" },
];
const GEN_DIFFICULTY_DEFAULT: GenerationDifficulty = "medium";

// Mirrors the server's 3/4/5 enum. Values are numbers, so the segment values are
// their string forms and are converted back on change.
const OPTIONS_SEGMENTS: ReadonlyArray<Segment<string>> = [
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
];
const GEN_OPTIONS_DEFAULT: OptionsPerQuestion = 4;

// Mirrors the server's questionType enum exactly.
const QUESTION_TYPE_SEGMENTS: ReadonlyArray<Segment<QuestionType>> = [
  { value: "single-only", label: "תשובה אחת" },
  { value: "allow-multi", label: "מעורב" },
  { value: "multi-only", label: "כמה תשובות" },
];
const GEN_QUESTION_TYPE_DEFAULT: QuestionType = "allow-multi";

/**
 * The "generate with AI" button — primary hero on an empty quiz, quiet "add
 * more" secondary once the quiz has questions. Opens the count chooser.
 */
function GenerateTrigger({
  hero,
  disabled,
  onOpen,
}: {
  hero: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <Button variant={hero ? "brand" : "secondary"} onClick={onOpen} disabled={disabled}>
      <Icon name="sparkle" size={16} />
      {hero ? "יצירת שאלות עם AI" : "עוד שאלות עם AI"}
    </Button>
  );
}

/**
 * Chooser dialog: pick how many questions to generate. The copy states the
 * questions are ADDED, so the number is never read as a running total, and names
 * the quiz's source language as a fact about this run — generation has no
 * language input, so the dialog must never read as a language choice.
 */
function GenerateModal({
  open,
  hasQuestions,
  baseLanguage,
  count,
  onCount,
  difficulty,
  onDifficulty,
  optionsPerQuestion,
  onOptionsPerQuestion,
  questionType,
  onQuestionType,
  onGenerate,
  onClose,
  busy,
}: {
  open: boolean;
  hasQuestions: boolean;
  baseLanguage: Language;
  count: number;
  onCount: (n: number) => void;
  difficulty: GenerationDifficulty;
  onDifficulty: (d: GenerationDifficulty) => void;
  optionsPerQuestion: OptionsPerQuestion;
  onOptionsPerQuestion: (n: OptionsPerQuestion) => void;
  questionType: QuestionType;
  onQuestionType: (t: QuestionType) => void;
  onGenerate: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <Modal open={open} title="יצירת שאלות עם AI" onClose={busy ? () => {} : onClose}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="gen-count" className="text-sm text-[var(--body)]">
            {hasQuestions ? "כמה שאלות חדשות להוסיף לחידון?" : "כמה שאלות ליצור?"}
          </label>
          <input
            id="gen-count"
            type="number"
            inputMode="numeric"
            min={GEN_COUNT_MIN}
            max={GEN_COUNT_MAX}
            value={count}
            onChange={(e) => {
              const n = Math.floor(Number(e.target.value));
              if (Number.isFinite(n)) {
                onCount(Math.max(GEN_COUNT_MIN, Math.min(GEN_COUNT_MAX, n)));
              }
            }}
            className="w-28 rounded-[var(--radius)] border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5 text-sm text-[var(--heading)] outline-none backdrop-blur-[20px] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
          />
          <span className="text-xs text-[var(--body-subtle)]">
            בין {GEN_COUNT_MIN} ל-{GEN_COUNT_MAX} שאלות
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-[var(--body)]">רמת קושי</span>
          <SegmentedToggle
            segments={DIFFICULTY_SEGMENTS}
            value={difficulty}
            onChange={onDifficulty}
            ariaLabel="רמת קושי"
            className="self-start"
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-[var(--body)]">תשובות לכל שאלה</span>
          <SegmentedToggle
            segments={OPTIONS_SEGMENTS}
            value={String(optionsPerQuestion)}
            onChange={(v) => onOptionsPerQuestion(Number(v) as OptionsPerQuestion)}
            ariaLabel="תשובות לכל שאלה"
            className="self-start"
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-[var(--body)]">סוג השאלות</span>
          <SegmentedToggle
            segments={QUESTION_TYPE_SEGMENTS}
            value={questionType}
            onChange={onQuestionType}
            ariaLabel="סוג השאלות"
            className="self-start"
          />
        </div>
        <p className="text-xs text-[var(--body-subtle)]">
          השאלות ייכתבו בשפת המקור של החידון ({LANGUAGE_LABELS[baseLanguage]}), גם אם
          הסרטון מדובר בשפה אחרת. תלמידים שקוראים בשפה אחרת מקבלים תרגום אוטומטי.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            ביטול
          </Button>
          <Button onClick={onGenerate} disabled={busy}>
            {busy ? <Spinner size={16} /> : <Icon name="sparkle" size={16} />}
            {hasQuestions ? "הוספת שאלות" : "יצירה"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The teacher quiz-authoring editor. Reads its initial tree from
 * `get_quiz_for_author` (passed by the server page) and drives every edit through
 * the documented surfaces: question upsert / AI generate go through
 * `/api/quizzes/[id]/*`; quiz-meta edits and soft-deletes call the owner-checked
 * RPCs directly. After each mutation it `router.refresh()`es so the server re-reads
 * the canonical tree.
 */
export function QuizEditor({
  initial,
  classes,
  allocations,
}: {
  initial: AuthorQuiz;
  classes: ClassRow[];
  allocations: QuizAllocation[];
}) {
  const router = useRouter();
  const quizId = initial.quiz_id;

  const [visibility, setVisibility] = useState<QuizVisibility>(initial.visibility);
  const [title, setTitle] = useState(initial.title ?? "");
  const [titleDirty, setTitleDirty] = useState(false);

  const [timeRestricted, setTimeRestricted] = useState(initial.time_restricted);
  const [durationMinutes, setDurationMinutes] = useState(
    initial.duration_minutes != null ? String(initial.duration_minutes) : ""
  );
  const [durationDirty, setDurationDirty] = useState(false);
  const [durationError, setDurationError] = useState<string | null>(null);
  const estimatedMinutes = estimateQuizMinutes(initial.video.duration_seconds);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AuthorQuestion | null>(null);

  const [banner, setBanner] = useState<{ kind: "danger" | "success"; msg: string } | null>(
    null
  );
  const [genBusy, setGenBusy] = useState(false);
  const [genModalOpen, setGenModalOpen] = useState(false);
  const [genCount, setGenCount] = useState(GEN_COUNT_DEFAULT);
  const [genDifficulty, setGenDifficulty] = useState<GenerationDifficulty>(
    GEN_DIFFICULTY_DEFAULT
  );
  const [genOptions, setGenOptions] = useState<OptionsPerQuestion>(
    GEN_OPTIONS_DEFAULT
  );
  const [genQuestionType, setGenQuestionType] = useState<QuestionType>(
    GEN_QUESTION_TYPE_DEFAULT
  );
  const [metaBusy, setMetaBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Preview-player position, and which question the timeline/list should
  // point at — driven by VideoPreviewPanel's onProgress and marker clicks.
  // `null` until the player's first progress tick, so the "current time"
  // prefill button never claims a fabricated 0:00 before playback starts.
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  // The video's length, as the player reports it. `videos.duration_seconds` is
  // null for most quizzes (the scrape that fills it is blocked), so the player
  // is the only reliable source — and it only knows once it has booted.
  const [duration, setDuration] = useState<number | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const videoPanelRef = useRef<VideoPreviewPanelHandle>(null);
  const cardRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const highlightTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (highlightTimeout.current) clearTimeout(highlightTimeout.current);
    };
  }, []);

  const questions = initial.questions;
  const paged = usePagedList(questions, { pageSize: QUESTIONS_PAGE_SIZE });
  const nextOrderIndex =
    questions.reduce((max, q) => Math.max(max, q.order_index), -1) + 1;
  const transcriptReady = initial.transcript_status === "ready";
  // Only a CONFIRMED no-captions video blocks AI generation. A `pending`
  // transcript is warmed on demand by the generate route (it single-flight
  // fetches, caches, and promotes the status), so the button must stay live —
  // it is the only teacher action that resolves `pending`.
  const transcriptUnavailable = initial.transcript_status === "unavailable";

  function refresh() {
    router.refresh();
  }

  async function saveTitle() {
    // A title is required (same form-level rule as the create form): the RPC
    // still accepts an empty string and stores NULL, but a quiz with no title
    // is indistinguishable from any other quiz on the same video wherever it
    // is listed. The button is disabled in this state; this is the backstop.
    if (title.trim() === "") return;
    setBanner(null);
    setMetaBusy(true);
    try {
      await updateQuizMeta(quizId, { title: title.trim() });
      setTitleDirty(false);
      refresh();
    } catch (e) {
      setBanner({
        kind: "danger",
        msg: e instanceof MutationError ? e.message : "עדכון הכותרת נכשל.",
      });
    } finally {
      setMetaBusy(false);
    }
  }

  /** Validates and saves the time-restriction toggle + minutes (issue #80).
   * Turning restriction off always clears the stored number server-side
   * (`update_quiz`'s own rule), regardless of what's left in the field. */
  async function saveDuration() {
    setBanner(null);
    setDurationError(null);
    let minutes: number | null = null;
    if (timeRestricted) {
      const n = Number(durationMinutes);
      if (!Number.isInteger(n) || n < 1) {
        setDurationError("משך הזמן חייב להיות מספר שלם גדול מ־0.");
        return;
      }
      minutes = n;
    }
    setMetaBusy(true);
    try {
      await updateQuizMeta(quizId, { timeRestricted, durationMinutes: minutes });
      setDurationDirty(false);
      refresh();
    } catch (e) {
      setBanner({
        kind: "danger",
        msg: e instanceof MutationError ? e.message : "עדכון משך הזמן נכשל.",
      });
    } finally {
      setMetaBusy(false);
    }
  }

  /**
   * Soft-deletes the open quiz and leaves the editor. Navigation is deliberate:
   * staying would leave the teacher editing a quiz that no longer exists.
   */
  async function deleteQuiz() {
    setBanner(null);
    setDeleting(true);
    try {
      await apiFetch<null>(`/api/quizzes/${quizId}`, { method: "DELETE" });
      router.push("/dashboard/quizzes");
      router.refresh();
    } catch (e) {
      setBanner({
        kind: "danger",
        msg: e instanceof ApiError ? e.message : "מחיקת החידון נכשלה.",
      });
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  async function changeVisibility(next: QuizVisibility) {
    if (next === visibility) return;
    setBanner(null);
    setMetaBusy(true);
    try {
      await updateQuizMeta(quizId, { visibility: next });
      setVisibility(next);
    } catch (e) {
      setBanner({
        kind: "danger",
        msg: e instanceof MutationError ? e.message : "עדכון הנראות נכשל.",
      });
    } finally {
      setMetaBusy(false);
    }
  }

  async function generate() {
    setBanner(null);
    setGenBusy(true);
    try {
      const { questions: created } = await apiFetch<{ questions: unknown[] }>(
        `/api/quizzes/${quizId}/generate`,
        {
          method: "POST",
          body: JSON.stringify({
            count: genCount,
            difficulty: genDifficulty,
            optionsPerQuestion: genOptions,
            questionType: genQuestionType,
          }),
        }
      );
      setBanner({
        kind: "success",
        msg: `נוצרו ${created.length} שאלות חדשות בעזרת AI.`,
      });
    } catch (e) {
      setBanner({
        kind: "danger",
        msg: e instanceof ApiError ? e.message : "יצירת השאלות נכשלה.",
      });
    } finally {
      setGenBusy(false);
      setGenModalOpen(false);
      // Re-read so the transcript badge and generate availability reflect the
      // outcome — e.g. a no-captions video promotes to `unavailable`, which
      // disables the button and shows the "add manually" hint.
      refresh();
    }
  }

  async function removeQuestion(q: AuthorQuestion) {
    if (!window.confirm("למחוק את השאלה? הפעולה אינה מחזירה את השאלה לרשימה.")) return;
    setBanner(null);
    try {
      await deleteQuestion(q.id);
      refresh();
    } catch (e) {
      setBanner({
        kind: "danger",
        msg: e instanceof MutationError ? e.message : "מחיקת השאלה נכשלה.",
      });
    }
  }

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(q: AuthorQuestion) {
    setEditing(q);
    setModalOpen(true);
    // Follow the preview to whatever the teacher is about to edit.
    setActiveQuestionId(q.id);
    videoPanelRef.current?.seekTo(q.position_seconds);
  }

  /** A timeline marker (or a cluster popover item) was picked: point the
   * question list at it with a transient highlight. Seeking the player
   * itself is VideoPreviewPanel's own responsibility.
   *
   * The timeline always carries every marker while the list below is paged, so
   * the picked question may live on another page — switch to it first, and let
   * the card mount before scrolling to it. */
  function handleMarkerSelect(q: AuthorQuestion) {
    setActiveQuestionId(q.id);
    if (highlightTimeout.current) clearTimeout(highlightTimeout.current);
    highlightTimeout.current = setTimeout(() => setActiveQuestionId(null), HIGHLIGHT_MS);

    const scroll = () =>
      cardRefs.current.get(q.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const index = questions.findIndex((x) => x.id === q.id);
    const targetPage = index < 0 ? paged.page : Math.floor(index / paged.pageSize);
    if (targetPage === paged.page) {
      scroll();
      return;
    }
    paged.onPageChange(targetPage);
    requestAnimationFrame(scroll);
  }

  /**
   * Resends one cached question through the same full-question upsert
   * `QuestionModal` already sends — there's no lightweight position-only
   * endpoint — with only `positionSeconds` changed. Returns whether it
   * succeeded; callers use that to decide whether the timeline's optimistic
   * drag position should stay pinned (until `refresh()`'s new data confirms
   * it) or snap back immediately.
   *
   * Passes the question's own `source` through so a drag can't silently flip
   * an AI-generated question to `authored` — the upsert endpoint has no
   * "leave unchanged" option, it defaults to `authored` when the field is
   * omitted, which is exactly what repositioning a `generated` question used
   * to do by accident.
   */
  async function saveQuestionPosition(
    q: AuthorQuestion,
    positionSeconds: number
  ): Promise<boolean> {
    // Draggable markers already exclude a null-prompt question; this is a
    // defensive backstop, not the primary guard.
    if (q.prompt == null) return false;
    try {
      await apiFetch(`/api/quizzes/${quizId}/questions`, {
        method: "POST",
        body: JSON.stringify({
          questionId: q.id,
          kind: q.kind,
          positionSeconds,
          orderIndex: q.order_index,
          basePrompt: q.prompt,
          baseExplanation: q.explanation,
          source: q.source === "generated" ? "generated" : "authored",
          options: q.options.map((o) => ({
            option_id: o.id,
            is_correct: o.is_correct,
            order_index: o.order_index,
            base_text: o.text ?? "",
          })),
        }),
      });
      return true;
    } catch (e) {
      setBanner({
        kind: "danger",
        msg: e instanceof ApiError ? e.message : "לא ניתן היה לעדכן את מיקום השאלה.",
      });
      return false;
    }
  }

  /** A single marker was dragged to a new position. */
  async function handleMarkerMove(questionId: string, positionSeconds: number): Promise<boolean> {
    const q = questions.find((x) => x.id === questionId);
    if (!q) return false;
    setBanner(null);
    const ok = await saveQuestionPosition(q, positionSeconds);
    // `refresh()` re-fetches the server-sorted tree so the timeline and the
    // list below agree afterward (mirrors 2.11) — and, via the new
    // `questions` it hands back down, confirms the timeline's pinned drag
    // position so it doesn't flicker back to the old spot first.
    if (ok) refresh();
    return ok;
  }

  /**
   * An entire cluster (2+ questions sharing a timestamp) was dragged
   * together — every member moves to the same new instant. All-or-nothing:
   * if any save fails, the whole cluster's optimistic position reverts
   * rather than leaving some questions moved and others not, since the
   * cluster's very premise is that they stay simultaneous.
   */
  async function handleClusterMove(
    questionIds: string[],
    positionSeconds: number
  ): Promise<boolean> {
    const targets = questionIds
      .map((id) => questions.find((x) => x.id === id))
      .filter((q): q is AuthorQuestion => q != null);
    if (targets.length === 0) return false;
    setBanner(null);
    const results = await Promise.all(
      targets.map((q) => saveQuestionPosition(q, positionSeconds))
    );
    const ok = results.every(Boolean);
    if (ok) {
      refresh();
    } else if (results.some(Boolean)) {
      // Partial failure: some already saved at the new position, others
      // didn't — surface that explicitly rather than the generic message
      // saveQuestionPosition already set for the failed one(s).
      setBanner({
        kind: "danger",
        msg: "עדכון המיקום הצליח לחלק מהשאלות בלבד. נסו שוב.",
      });
    }
    return ok;
  }

  const heading = title.trim() || initial.video.title || "חידון ללא כותרת";
  // Emptying the box is an unsaveable state, not a way to clear the title.
  const titleInvalid = titleDirty && title.trim() === "";

  return (
    <div className="flex flex-col gap-6">
      {/* Page header: what this quiz is, the two facts that describe its size,
          and the one destructive action — deliberately out of the settings box
          below, where it used to hide as a text link. */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold text-[var(--heading)]">
            {heading}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--body-subtle)]">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="quiz" size={14} />
              <span className="tabular-nums">{questions.length}</span> שאלות
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="clock" size={14} />
              {duration != null ? (
                <>
                  אורך הסרטון{" "}
                  <span className="tabular-nums">{formatTime(duration)}</span>
                </>
              ) : (
                "אורך הסרטון ייקבע עם טעינת הנגן"
              )}
            </span>
          </p>
        </div>
        <IconButton
          name="trash"
          label="מחיקת החידון"
          variant="danger"
          tooltipPlacement="bottom"
          disabled={metaBusy || deleting}
          onClick={() => setDeleteOpen(true)}
        />
      </header>

      {banner && <Alert variant={banner.kind}>{banner.msg}</Alert>}

      {/* 1 · Title + who can see the quiz */}
      <GlassCard className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="quiz-title" className="text-sm font-medium text-[var(--heading)]">
            כותרת החידון
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="quiz-title"
              value={title}
              placeholder="חידון ללא כותרת"
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleDirty(true);
              }}
              className="min-w-0 flex-1 rounded-[var(--radius)] border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5 text-sm text-[var(--heading)] outline-none backdrop-blur-[20px] transition-colors placeholder:text-[var(--body)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
            />
            {titleDirty && (
              <Button
                size="sm"
                onClick={saveTitle}
                disabled={metaBusy || titleInvalid}
              >
                {metaBusy ? <Spinner size={16} /> : "שמירה"}
              </Button>
            )}
          </div>
          {titleInvalid && (
            <p className="text-sm text-[var(--fg-danger)]">יש להזין כותרת לחידון.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--glass-border)] pt-4">
          <SegmentedToggle<QuizVisibility>
            segments={VISIBILITY_SEGMENTS}
            value={visibility}
            onChange={changeVisibility}
            ariaLabel="מי רואה את החידון"
          />
          <span className="text-xs text-[var(--body-subtle)]">
            {visibility === "private"
              ? "רק אתם רואים את החידון."
              : "מורים אחרים בבית הספר יכולים למצוא ולשכפל אותו."}
          </span>
          {metaBusy && <Spinner size={16} />}
        </div>
      </GlassCard>

      {/* Quiz length: its own block, not a field buried in the settings box.
          Unrestricted is the default and shows the estimate the student will
          see; restricting it asks for the one number that then replaces it. */}
      <GlassCard className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-[var(--heading)]">
              משך החידון
            </span>
            <span className="text-xs text-[var(--body-subtle)]">
              {timeRestricted
                ? "התלמידים יראו את המשך שתקבעו."
                : estimatedMinutes != null
                  ? `התלמידים יראו הערכה מאורך הסרטון: ~${estimatedMinutes} דקות.`
                  : "אורך הסרטון אינו ידוע — לא תוצג הערכה."}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedToggle<DurationMode>
              segments={DURATION_SEGMENTS}
              value={timeRestricted ? "restricted" : "estimated"}
              onChange={(mode) => {
                setTimeRestricted(mode === "restricted");
                setDurationDirty(true);
              }}
              ariaLabel="אופן קביעת משך החידון"
            />
            {timeRestricted && (
              <label className="flex items-center gap-2 text-sm text-[var(--body)]">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={durationMinutes}
                  onChange={(e) => {
                    setDurationMinutes(e.target.value);
                    setDurationDirty(true);
                  }}
                  placeholder="דקות"
                  aria-label="משך החידון בדקות"
                  className="w-24 rounded-[var(--radius)] border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-1.5 text-sm tabular-nums text-[var(--heading)] outline-none backdrop-blur-[20px] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
                />
                דקות
              </label>
            )}
            {durationDirty && (
              <Button size="sm" onClick={saveDuration} disabled={metaBusy}>
                {metaBusy ? <Spinner size={16} /> : "שמירה"}
              </Button>
            )}
          </div>
        </div>
        {durationError && (
          <p className="text-sm text-[var(--fg-danger)]">{durationError}</p>
        )}
      </GlassCard>

      {/* 2 · The video itself — the real player, with the checkpoint timeline
          under it. No link out: the quiz is authored against this player. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-[var(--heading)]">הסרטון</h2>
        <VideoPreviewPanel
          ref={videoPanelRef}
          youtubeVideoId={initial.video.youtube_video_id}
          questions={questions}
          activeQuestionId={activeQuestionId}
          onMarkerSelect={handleMarkerSelect}
          onMarkerMove={handleMarkerMove}
          onClusterMove={handleClusterMove}
          onProgress={(current, reportedDuration) => {
            setCurrentTime(current);
            // 0 means "not known yet" — never regress a known duration.
            if (reportedDuration > 0) setDuration(reportedDuration);
          }}
        />
      </section>

      {/* 3 · Questions */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--heading)]">
            שאלות (<span className="tabular-nums">{questions.length}</span>)
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {questions.length > 0 && !transcriptUnavailable && (
              <GenerateTrigger
                hero={false}
                disabled={genBusy}
                onOpen={() => setGenModalOpen(true)}
              />
            )}
            <Button onClick={openNew}>
              <Icon name="plus" size={16} />
              הוספת שאלה
            </Button>
          </div>
        </div>

        {/* Why the AI action is missing on a quiz that already has questions —
            the transcript tag that used to carry this is gone, but the reason
            for a hidden button still has to be legible. */}
        {questions.length > 0 && transcriptUnavailable && (
          <p className="flex items-center gap-1.5 text-sm text-[var(--body-subtle)]">
            <Icon name="info" size={14} className="flex-none" />
            בניסיון האחרון לא נמצאו כתוביות לסרטון, אז יצירת שאלות עם AI אינה זמינה. אפשר להוסיף שאלות ידנית.
          </p>
        )}

        {questions.length === 0 ? (
          <GlassCard className="flex flex-col items-center gap-4 py-10 text-center">
            <Icon name="sparkle" size={28} className="text-[var(--body-subtle)]" />
            <p className="text-[var(--body)]">
              אין עדיין שאלות. צרו אותן עם AI מתוך תמליל הסרטון, או הוסיפו ידנית.
            </p>
            {/* Never disabled on `unavailable`. That verdict can come from a
                blocked fetch, and disabling the button removed the only way for
                a teacher to retry — making one bad fetch permanent. */}
            <GenerateTrigger hero disabled={genBusy} onOpen={() => setGenModalOpen(true)} />
            {transcriptUnavailable ? (
              <span className="text-sm text-[var(--body-subtle)]">
                בניסיון האחרון לא נמצאו כתוביות. אפשר לנסות שוב או להוסיף שאלות ידנית.
              </span>
            ) : (
              !transcriptReady && (
                <span className="text-sm text-[var(--body-subtle)]">
                  בלחיצה על ״יצירת שאלות עם AI״ נטען את תמליל הסרטון וניצור שאלות — עשוי להימשך מספר שניות.
                </span>
              )
            )}
          </GlassCard>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {paged.slice.map((q) => (
                <QuestionListItem
                  key={q.id}
                  question={q}
                  active={activeQuestionId === q.id}
                  cardRef={(el) => {
                    if (el) cardRefs.current.set(q.id, el);
                    else cardRefs.current.delete(q.id);
                  }}
                  onEdit={() => openEdit(q)}
                  onDelete={() => removeQuestion(q)}
                />
              ))}
            </ul>
            <Pager {...paged} label="ניווט בין שאלות" />
          </>
        )}
      </section>

      {/* 4 · Allocations */}
      <AllocationsSection quizId={quizId} classes={classes} allocations={allocations} />


      <GenerateModal
        open={genModalOpen}
        hasQuestions={questions.length > 0}
        baseLanguage={initial.base_language}
        count={genCount}
        onCount={setGenCount}
        difficulty={genDifficulty}
        onDifficulty={setGenDifficulty}
        optionsPerQuestion={genOptions}
        onOptionsPerQuestion={setGenOptions}
        questionType={genQuestionType}
        onQuestionType={setGenQuestionType}
        onGenerate={generate}
        onClose={() => setGenModalOpen(false)}
        busy={genBusy}
      />

      <QuestionModal
        open={modalOpen}
        quizId={quizId}
        question={editing}
        nextOrderIndex={nextOrderIndex}
        currentPlayerSeconds={currentTime}
        onClose={() => setModalOpen(false)}
        onSaved={refresh}
      />

      <Modal
        open={deleteOpen}
        title="מחיקת חידון"
        onClose={() => {
          if (!deleting) setDeleteOpen(false);
        }}
      >
        <p className="text-sm text-[var(--body)]">
          למחוק את &rdquo;{title.trim() || initial.video.title || "החידון"}&ldquo;?
          החידון ייעלם מהספרייה וממאגר בית הספר. תשובות ונתוני אנליטיקה של תלמידים
          שכבר פתרו אותו יישמרו.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => setDeleteOpen(false)}
            disabled={deleting}
          >
            ביטול
          </Button>
          <Button variant="danger" onClick={deleteQuiz} disabled={deleting}>
            {deleting ? <Spinner size={16} /> : null}
            מחיקה
          </Button>
        </div>
      </Modal>
    </div>
  );
}

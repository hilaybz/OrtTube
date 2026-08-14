"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
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
import { QuestionModal } from "./QuestionModal";
import { AllocationsSection } from "./AllocationsSection";
import { VideoPreviewPanel, type VideoPreviewPanelHandle } from "./VideoPreviewPanel";
import { QuestionListItem } from "./QuestionListItem";
import { updateQuizMeta, deleteQuestion, MutationError } from "./mutations";
import { LANGUAGE_LABELS } from "./format";

// How long a marker-click highlight lingers on the matching question card.
const HIGHLIGHT_MS = 1600;

// `unavailable` records that the last attempt found no usable captions — which
// may mean the video has none, or that the fetch was blocked. The label must not
// assert either, because we frequently cannot tell them apart, and the verdict
// expires so a retry is worth offering.
const TRANSCRIPT_LABEL: Record<AuthorQuiz["transcript_status"], string> = {
  ready: "תמליל מוכן",
  pending: "תמליל טרם נטען",
  unavailable: "לא נמצאו כתוביות בניסיון האחרון",
};

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
    setBanner(null);
    setMetaBusy(true);
    try {
      // Send the trimmed string, empty included: an empty title is the teacher
      // clearing it, which the RPC stores as NULL so the card falls back to the
      // video's title. Sending null here would read as "unchanged" instead.
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

  async function toggleVisibility() {
    setBanner(null);
    const next: QuizVisibility = visibility === "private" ? "shared" : "private";
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
   * itself is VideoPreviewPanel's own responsibility. */
  function handleMarkerSelect(q: AuthorQuestion) {
    setActiveQuestionId(q.id);
    cardRefs.current.get(q.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (highlightTimeout.current) clearTimeout(highlightTimeout.current);
    highlightTimeout.current = setTimeout(() => setActiveQuestionId(null), HIGHLIGHT_MS);
  }

  /**
   * Resends one cached question through the same full-question upsert
   * `QuestionModal` already sends — there's no lightweight position-only
   * endpoint — with only `positionSeconds` changed. Returns whether it
   * succeeded; callers use that to decide whether the timeline's optimistic
   * drag position should stay pinned (until `refresh()`'s new data confirms
   * it) or snap back immediately.
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

  return (
    <div className="mx-auto max-w-4xl py-2">
      {/* Header */}
      <GlassCard className="mb-6 flex flex-col gap-4">
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
              <Button size="sm" onClick={saveTitle} disabled={metaBusy}>
                {metaBusy ? <Spinner size={16} /> : "שמירה"}
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge variant="gray">שפת מקור: {LANGUAGE_LABELS[initial.base_language]}</Badge>
          <Badge variant={transcriptReady ? "success" : "warning"}>
            {TRANSCRIPT_LABEL[initial.transcript_status]}
          </Badge>
          <a
            href={`https://www.youtube.com/watch?v=${initial.video.youtube_video_id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-[var(--fg-brand)] underline"
          >
            <Icon name="play" size={14} />
            {initial.video.title ?? "צפייה בסרטון"}
          </a>
          <div className="ms-auto flex items-center gap-2">
            <span className="text-[var(--body)]">נראות:</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={toggleVisibility}
              disabled={metaBusy}
            >
              <Icon name={visibility === "private" ? "lock" : "users"} size={16} />
              {visibility === "private" ? "פרטי" : "משותף לביה״ס"}
            </Button>
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              disabled={metaBusy || deleting}
              className="rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium text-[var(--body-subtle)] hover:bg-[var(--neutral-quaternary)] hover:text-[var(--fg-danger)] disabled:opacity-50"
            >
              מחיקת החידון
            </button>
          </div>
        </div>
      </GlassCard>

      <AllocationsSection quizId={quizId} classes={classes} allocations={allocations} />

      {banner && (
        <Alert variant={banner.kind} className="mb-6">
          {banner.msg}
        </Alert>
      )}

      {/* AI actions — the hero action on an empty quiz; once the quiz has
          questions it moves into the questions header as a quiet "add more". */}
      {questions.length === 0 && (
        <GlassCard className="mb-6 flex flex-col gap-4">
          {/* Never disabled on `unavailable`. That verdict can come from a
              blocked fetch, and disabling the button removed the only way for a
              teacher to retry — making one bad fetch permanent. Pressing it now
              forces a real re-check. */}
          <GenerateTrigger
            hero
            disabled={genBusy}
            onOpen={() => setGenModalOpen(true)}
          />
          {transcriptUnavailable ? (
            <span className="text-sm text-[var(--body)]">
              בניסיון האחרון לא נמצאו כתוביות. אפשר לנסות שוב או להוסיף שאלות ידנית.
            </span>
          ) : (
            !transcriptReady && (
              <span className="text-sm text-[var(--body)]">
                בלחיצה על ״יצירת שאלות עם AI״ נטען את תמליל הסרטון וניצור שאלות — עשוי להימשך מספר שניות.
              </span>
            )
          )}
        </GlassCard>
      )}

      <VideoPreviewPanel
        ref={videoPanelRef}
        youtubeVideoId={initial.video.youtube_video_id}
        questions={questions}
        activeQuestionId={activeQuestionId}
        onMarkerSelect={handleMarkerSelect}
        onMarkerMove={handleMarkerMove}
        onClusterMove={handleClusterMove}
        onProgress={(current) => setCurrentTime(current)}
      />

      {/* Questions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-[var(--heading)]">
          שאלות ({questions.length})
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {questions.length > 0 && !transcriptUnavailable && (
            <GenerateTrigger
              hero={false}
              disabled={genBusy}
              onOpen={() => setGenModalOpen(true)}
            />
          )}
          <Button onClick={openNew}>הוספת שאלה</Button>
        </div>
      </div>

      {questions.length === 0 ? (
        <GlassCard>
          <p className="text-[var(--body)]">
            אין עדיין שאלות. הוסיפו שאלה ידנית או צרו שאלות עם AI.
          </p>
        </GlassCard>
      ) : (
        <ul className="flex flex-col gap-3">
          {questions.map((q) => (
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
      )}

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

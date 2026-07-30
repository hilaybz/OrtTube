"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { apiFetch, ApiError } from "@/lib/http";
import type { AuthorQuestion, AuthorQuiz, QuizVisibility } from "@/lib/quizAuthor";
import { QuestionModal } from "./QuestionModal";
import { updateQuizMeta, deleteQuestion, MutationError } from "./mutations";
import { formatTime, LANGUAGE_LABELS } from "./format";

const TRANSCRIPT_LABEL: Record<AuthorQuiz["transcript_status"], string> = {
  ready: "תמליל מוכן",
  pending: "תמליל טרם נטען",
  unavailable: "אין כתוביות לסרטון",
};

const GEN_COUNT_OPTIONS = [3, 5, 10];

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
 * questions are ADDED, so the number is never read as a running total.
 */
function GenerateModal({
  open,
  hasQuestions,
  count,
  onCount,
  onGenerate,
  onClose,
  busy,
}: {
  open: boolean;
  hasQuestions: boolean;
  count: number;
  onCount: (n: number) => void;
  onGenerate: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <Modal open={open} title="יצירת שאלות עם AI" onClose={busy ? () => {} : onClose}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-[var(--body)]">
            {hasQuestions ? "כמה שאלות חדשות להוסיף לחידון?" : "כמה שאלות ליצור?"}
          </span>
          <SegmentedToggle
            ariaLabel="מספר שאלות"
            segments={GEN_COUNT_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
            value={String(count)}
            onChange={(v) => onCount(Number(v))}
          />
        </div>
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
export function QuizEditor({ initial }: { initial: AuthorQuiz }) {
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
  const [genCount, setGenCount] = useState(GEN_COUNT_OPTIONS[0]);
  const [metaBusy, setMetaBusy] = useState(false);

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
      await updateQuizMeta(quizId, { title: title.trim() || null });
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
        { method: "POST", body: JSON.stringify({ count: genCount }) }
      );
      setBanner({
        kind: "success",
        msg: `נוצרו ${created.length} שאלות חדשות בעזרת AI.`,
      });
      refresh();
    } catch (e) {
      setBanner({
        kind: "danger",
        msg: e instanceof ApiError ? e.message : "יצירת השאלות נכשלה.",
      });
    } finally {
      setGenBusy(false);
      setGenModalOpen(false);
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
          </div>
        </div>
      </GlassCard>

      {banner && (
        <Alert variant={banner.kind} className="mb-6">
          {banner.msg}
        </Alert>
      )}

      {/* AI actions — the hero action on an empty quiz; once the quiz has
          questions it moves into the questions header as a quiet "add more". */}
      {questions.length === 0 && (
        <GlassCard className="mb-6 flex flex-col gap-4">
          <GenerateTrigger
            hero
            disabled={genBusy || transcriptUnavailable}
            onOpen={() => setGenModalOpen(true)}
          />
          {transcriptUnavailable ? (
            <span className="text-sm text-[var(--body)]">
              אין כתוביות לסרטון — הוסיפו שאלות ידנית.
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
          {questions.map((q) => {
            const correct = q.options.filter((o) => o.is_correct).length;
            return (
              <li key={q.id}>
                <GlassCard className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="gray" pill>
                      <Icon name="clock" size={12} />
                      {formatTime(q.position_seconds)}
                    </Badge>
                    <Badge variant="brand">
                      {q.kind === "single" ? "תשובה אחת" : "מספר תשובות"}
                    </Badge>
                    <span className="text-xs text-[var(--body-subtle)]">
                      {q.options.length} אפשרויות · {correct} נכונות
                    </span>
                    <div className="ms-auto flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(q)}>
                        עריכה
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeQuestion(q)}
                        className="text-[var(--fg-danger)]"
                      >
                        מחיקה
                      </Button>
                    </div>
                  </div>
                  <p className="font-medium text-[var(--heading)]">
                    {q.prompt ?? "(ללא ניסוח)"}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {q.options.map((o) => (
                      <li
                        key={o.id}
                        className="flex items-center gap-2 text-sm text-[var(--body)]"
                      >
                        <Icon
                          name={o.is_correct ? "check" : "close"}
                          size={14}
                          className={
                            o.is_correct
                              ? "text-[var(--fg-success)]"
                              : "text-[var(--body-subtle)]"
                          }
                        />
                        {o.text ?? "(ללא טקסט)"}
                      </li>
                    ))}
                  </ul>
                </GlassCard>
              </li>
            );
          })}
        </ul>
      )}

      <GenerateModal
        open={genModalOpen}
        hasQuestions={questions.length > 0}
        count={genCount}
        onCount={setGenCount}
        onGenerate={generate}
        onClose={() => setGenModalOpen(false)}
        busy={genBusy}
      />

      <QuestionModal
        open={modalOpen}
        quizId={quizId}
        question={editing}
        nextOrderIndex={nextOrderIndex}
        onClose={() => setModalOpen(false)}
        onSaved={refresh}
      />
    </div>
  );
}

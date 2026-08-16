"use client";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/ui/Icon";
import { apiFetch, ApiError } from "@/lib/http";
import type { PreviewQuiz } from "@/lib/sharing";
import type { AuthorQuestion } from "@/lib/quizAuthor";
import {
  VideoPreviewPanel,
  type VideoPreviewPanelHandle,
} from "@/components/teacher/editor/VideoPreviewPanel";
import { QuestionListItem } from "@/components/teacher/editor/QuestionListItem";

// How long a marker-click highlight lingers on the matching question card —
// mirrors QuizEditor.tsx's own HIGHLIGHT_MS exactly.
const HIGHLIGHT_MS = 1600;

/**
 * Read-only preview of a quiz before cloning it (backlog 1.3 / issue #13):
 * the same video+timeline+question-list surface `QuizEditor.tsx` renders for
 * an owner, reused component-for-component (`VideoPreviewPanel` with no
 * move handlers, `QuestionListItem` with no edit/delete callbacks) so a
 * teacher sees exactly what they'd get, correct answers and explanations
 * included, with a "שכפול" action right here instead of committing blind.
 *
 * `onClone` is optional: the class page's assigned-quiz rows reuse this same
 * surface for a shared quiz the viewing teacher didn't author, purely to look
 * at it (the editor is off-limits for a quiz they don't own) — no clone
 * button renders when it's omitted.
 *
 * `getQuizForPreview` fetched client-side (not passed down from the server
 * page) since this opens from a modal on the already-rendered library page,
 * not from a route transition.
 */
export function QuizPreviewModal({
  open,
  quizId,
  onClose,
  onClone,
  cloning,
}: {
  open: boolean;
  /** Empty string when nothing is open yet — the fetch effect no-ops on it. */
  quizId: string;
  onClose: () => void;
  onClone?: (quizId: string) => void | Promise<void>;
  cloning?: boolean;
}) {
  const [quiz, setQuiz] = useState<PreviewQuiz | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const videoPanelRef = useRef<VideoPreviewPanelHandle>(null);
  const cardRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const highlightTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (highlightTimeout.current) clearTimeout(highlightTimeout.current);
    };
  }, []);

  useEffect(() => {
    if (!open || !quizId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setQuiz(null);
      setActiveQuestionId(null);
      try {
        const { quiz: fetched } = await apiFetch<{ quiz: PreviewQuiz }>(
          `/api/quizzes/${quizId}/preview`
        );
        if (!cancelled) setQuiz(fetched);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : "לא ניתן היה לטעון את החידון.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();

    return () => {
      cancelled = true;
    };
  }, [open, quizId]);

  function handleMarkerSelect(q: AuthorQuestion) {
    setActiveQuestionId(q.id);
    cardRefs.current.get(q.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (highlightTimeout.current) clearTimeout(highlightTimeout.current);
    highlightTimeout.current = setTimeout(() => setActiveQuestionId(null), HIGHLIGHT_MS);
  }

  // Close either way: on success `onClone` navigates to the editor, so this
  // is moot; on failure it surfaces the library page's own error Alert,
  // which the modal would otherwise sit on top of and hide.
  async function handleClone() {
    if (!onClone) return;
    await onClone(quizId);
    onClose();
  }

  return (
    <Modal open={open} title="תצוגה מקדימה" onClose={onClose} className="max-w-3xl">
      <div className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto pe-1">
        {loading && (
          <div className="flex justify-center py-10">
            <Spinner size={24} />
          </div>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
        {quiz && (
          <>
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-semibold text-[var(--heading)]">
                {quiz.title ?? quiz.video.title ?? "חידון"}
              </h3>
              {quiz.title && quiz.video.title && (
                <p className="flex items-center gap-1.5 text-xs text-[var(--body-subtle)]">
                  <Icon name="play" size={12} className="flex-none" />
                  {quiz.video.title}
                </p>
              )}
              {quiz.author_name && (
                <p className="text-xs text-[var(--body-subtle)]">מאת {quiz.author_name}</p>
              )}
            </div>

            <VideoPreviewPanel
              ref={videoPanelRef}
              youtubeVideoId={quiz.video.youtube_video_id}
              questions={quiz.questions}
              activeQuestionId={activeQuestionId}
              onMarkerSelect={handleMarkerSelect}
            />

            {quiz.questions.length === 0 ? (
              <p className="text-[var(--body)]">אין שאלות בחידון זה.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {quiz.questions.map((q) => (
                  <QuestionListItem
                    key={q.id}
                    question={q}
                    active={activeQuestionId === q.id}
                    cardRef={(el) => {
                      if (el) cardRefs.current.set(q.id, el);
                      else cardRefs.current.delete(q.id);
                    }}
                  />
                ))}
              </ul>
            )}
          </>
        )}

        {/* Modal's own header already has a close (X) button — no need to
            duplicate it here, only the action this surface adds. Omitted
            entirely for a read-only preview (no `onClone`). */}
        {onClone && (
          <div className="flex justify-end pt-2">
            <Button onClick={handleClone} disabled={cloning || !quiz}>
              {cloning ? <Spinner size={16} /> : <Icon name="grid" size={16} />}
              שכפול
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

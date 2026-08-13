"use client";
import { useState } from "react";
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
import { apiFetch, ApiError } from "@/lib/http";
import type { MyQuiz } from "@/lib/quiz";
import type { SharedQuiz } from "@/lib/sharing";
import type { QuizAllocationTags } from "@/lib/allocations";
import { QuizCard, cardHeading, VideoLine, QuizMeta } from "@/components/teacher/QuizCard";

type TabKey = "mine" | "school";

/**
 * The teacher quiz library: their own quizzes plus the same-school shared
 * catalog they can clone. Reads are done server-side (RLS) and handed in;
 * this component owns tab state and the clone mutation (POST /api/quizzes/share).
 */
export function QuizLibrary({
  myQuizzes,
  sharedQuizzes,
  allocationTags,
}: {
  myQuizzes: MyQuiz[];
  sharedQuizzes: SharedQuiz[];
  /** quiz_id → allocation tags (backlog 1.5), keyed for O(1) lookup per card. */
  allocationTags: Record<string, QuizAllocationTags>;
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
        <MineTab quizzes={myQuizzes} allocationTags={allocationTags} />
      ) : (
        <SchoolTab quizzes={sharedQuizzes} />
      )}
    </div>
  );
}

function MineTab({
  quizzes,
  allocationTags,
}: {
  quizzes: MyQuiz[];
  allocationTags: Record<string, QuizAllocationTags>;
}) {
  const router = useRouter();
  const [pendingDelete, setPendingDelete] = useState<MyQuiz | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {quizzes.map((q) => (
            <QuizCard
              key={q.quiz_id}
              quiz={q}
              tags={allocationTags[q.quiz_id]}
              onRequestDelete={setPendingDelete}
            />
          ))}
        </div>
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

function SchoolTab({ quizzes }: { quizzes: SharedQuiz[] }) {
  const router = useRouter();
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {quizzes.map((q) => {
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
    </div>
  );
}

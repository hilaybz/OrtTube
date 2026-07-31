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
import { apiFetch, ApiError } from "@/lib/http";
import type { MyQuiz } from "@/lib/quiz";
import type { SharedQuiz } from "@/lib/sharing";
import type { Language } from "@/lib/lang";

const LANG_LABEL: Record<Language, string> = {
  he: "עברית",
  ar: "ערבית",
  en: "אנגלית",
};

type TabKey = "mine" | "school";

/**
 * The teacher quiz library: their own quizzes plus the same-school shared
 * catalog they can clone. Reads are done server-side (RLS) and handed in;
 * this component owns tab state and the clone mutation (POST /api/quizzes/share).
 */
export function QuizLibrary({
  myQuizzes,
  sharedQuizzes,
}: {
  myQuizzes: MyQuiz[];
  sharedQuizzes: SharedQuiz[];
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
        <MineTab quizzes={myQuizzes} />
      ) : (
        <SchoolTab quizzes={sharedQuizzes} />
      )}
    </div>
  );
}

function QuizMeta({
  baseLanguage,
  questionCount,
}: {
  baseLanguage: Language;
  questionCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="gray">{LANG_LABEL[baseLanguage] ?? baseLanguage}</Badge>
      <span className="text-xs text-[var(--body-subtle)]">
        <span className="tabular-nums">{questionCount}</span> שאלות
      </span>
    </div>
  );
}

function MineTab({ quizzes }: { quizzes: MyQuiz[] }) {
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
      {quizzes.length === 0 ? (
        <GlassCard>
          <p className="text-[var(--body)]">
            עדיין לא יצרת חידונים. צרו חידון חדש כדי להתחיל.
          </p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {quizzes.map((q) => (
            <Link
              key={q.quiz_id}
              href={`/dashboard/quizzes/${q.quiz_id}/edit`}
              className="group block focus-visible:outline-none"
            >
              <GlassCard interactive className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-[var(--heading)]">
                    {q.title ?? q.video_title ?? "חידון"}
                  </h3>
                  <Badge variant={q.visibility === "shared" ? "brand" : "gray"}>
                    {q.visibility === "shared" ? "משותף" : "פרטי"}
                  </Badge>
                </div>
                <QuizMeta
                  baseLanguage={q.base_language}
                  questionCount={q.question_count}
                />
                <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-[var(--fg-brand)]">
                  עריכה
                  <Icon name="arrow" size={16} />
                </span>
              </GlassCard>
            </Link>
          ))}
        </div>
      )}
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
                  {q.title ?? q.video_title ?? "חידון"}
                </h3>
                {q.is_own && <Badge variant="brand">שלי</Badge>}
              </div>
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

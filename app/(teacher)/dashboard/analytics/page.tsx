import { Suspense } from "react";
import { BackLink } from "@/components/ui/BackLink";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { AnalyticsSearch } from "@/components/teacher/analytics/AnalyticsSearch";
import { ClassAnalyticsView } from "@/components/teacher/analytics/ClassAnalyticsView";
import { StudentAnalyticsView } from "@/components/teacher/analytics/StudentAnalyticsView";
import { QuizAnalyticsView } from "@/components/teacher/analytics/QuizAnalyticsView";
import type { AnalyticsScope } from "@/lib/analytics";

/**
 * The analytics hub.
 *
 * ONE route renders all three entity views, selected by the URL:
 * `/dashboard/analytics?scope=student|class|quiz&id=<uuid>`. That contract is
 * what the rest of the app links into — `components/teacher/classes/
 * analyticsLinks.ts` builds every such href — so it is deliberately narrow and
 * deliberately stable: a scope plus an id, nothing positional, nothing nested.
 * A view is therefore linkable, refresh-safe, and shareable, while the search
 * QUERY stays client state, because turning every keystroke into a server
 * navigation would be the wrong trade for something nobody bookmarks.
 *
 * `scope` is validated and `id` must look like a uuid, so a hand-edited URL
 * lands on the search screen rather than a failed read.
 */

const SCOPES: AnalyticsScope[] = ["student", "class", "quiz"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeScope(raw: string | string[] | undefined): AnalyticsScope {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return SCOPES.includes(value as AnalyticsScope)
    ? (value as AnalyticsScope)
    : "class";
}

function normalizeId(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && UUID.test(value) ? value : null;
}

const SCOPE_TITLE: Record<AnalyticsScope, string> = {
  student: "אנליטיקה של תלמיד/ה",
  class: "אנליטיקה של כיתה",
  quiz: "אנליטיקה של חידון",
};

export default async function AnalyticsHubPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const scope = normalizeScope(params.scope);
  const id = normalizeId(params.id);

  if (!id) {
    return (
      <div className="mx-auto max-w-3xl py-2">
        <h1 className="mb-1 text-3xl font-bold tracking-tight">אנליטיקה</h1>
        <p className="mb-6 text-[var(--body)]">
          חפשו תלמיד/ה, כיתה או חידון כדי לראות את הנתונים שלו.
        </p>
        <GlassCard>
          <AnalyticsSearch scope={scope} selectedId={null} />
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl py-2">
      <header className="mb-6 flex flex-col gap-2">
        <BackLink
          href={`/dashboard/analytics?scope=${scope}`}
          label="חיפוש באנליטיקה"
        />
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <Icon
            name="chartLine"
            size={26}
            className="flex-none text-[var(--fg-brand)]"
          />
          {SCOPE_TITLE[scope]}
        </h1>
      </header>

      <Suspense key={`${scope}:${id}`} fallback={<ViewSkeleton />}>
        {scope === "student" ? (
          <StudentAnalyticsView studentId={id} />
        ) : scope === "quiz" ? (
          <QuizAnalyticsView quizId={id} />
        ) : (
          <ClassAnalyticsView classId={id} />
        )}
      </Suspense>
    </div>
  );
}

/** Held-frame loading state: the page chrome stays, the data area says so. */
function ViewSkeleton() {
  return (
    <div className="glass flex items-center justify-center gap-2 p-12 text-sm text-[var(--body-subtle)]">
      <Spinner size={20} />
      טוען נתונים…
    </div>
  );
}

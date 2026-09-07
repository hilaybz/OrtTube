import type { SupabaseClient } from "@supabase/supabase-js";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/ui/BackLink";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { AnalyticsSearch } from "@/components/teacher/analytics/AnalyticsSearch";
import { ClassAnalyticsView } from "@/components/teacher/analytics/ClassAnalyticsView";
import { StudentAnalyticsView } from "@/components/teacher/analytics/StudentAnalyticsView";
import { QuizAnalyticsView } from "@/components/teacher/analytics/QuizAnalyticsView";
import { quizAnalyticsHref } from "@/components/teacher/analyticsLinks";
import { getClassName } from "@/lib/classes";
import type { AnalyticsScope } from "@/lib/analytics";

/**
 * ONE route renders every analytics view, selected by the URL:
 * `/dashboard/analytics?scope=student|class|quiz&id=<uuid>`. That contract is
 * what the rest of the app links into — `components/teacher/analyticsLinks.ts`
 * builds every such href — so it is deliberately narrow and deliberately
 * stable: a scope plus an id, nothing positional, nothing nested. A view is
 * therefore linkable, refresh-safe, and shareable, while the search QUERY stays
 * client state, because turning every keystroke into a server navigation would
 * be the wrong trade for something nobody bookmarks.
 *
 * `scope` is validated and both ids must look like a uuid, so a hand-edited URL
 * lands on the search screen (or the unfiltered quiz) rather than a failed read.
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
  // Only the quiz scope narrows; a `class` param anywhere else is ignored rather
  // than redirected, so a stray one degrades to the plain view.
  const filterClassId = scope === "quiz" ? normalizeId(params.class) : null;

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

  let title = SCOPE_TITLE[scope];
  if (scope === "class") {
    const client = (await createClient()) as unknown as SupabaseClient;
    let className: string | null = null;
    try {
      className = await getClassName(client, id);
    } catch {
      className = null;
    }
    if (className) title = `אנליטיקה של ${className}`;
  }

  return (
    <div className="mx-auto max-w-6xl py-2">
      <header className="mb-6 flex flex-col gap-2">
        {filterClassId ? (
          <BackLink
            href={quizAnalyticsHref(id)}
            label="אנליטיקה של החידון"
            from={params.from}
          />
        ) : (
          <BackLink
            href={`/dashboard/analytics?scope=${scope}`}
            label="חיפוש באנליטיקה"
            from={params.from}
          />
        )}
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <Icon
            name="chartLine"
            size={26}
            className="flex-none text-[var(--fg-brand)]"
          />
          {title}
        </h1>
      </header>

      <Suspense
        key={`${scope}:${id}:${filterClassId ?? ""}`}
        fallback={<ViewSkeleton />}
      >
        {scope === "student" ? (
          <StudentAnalyticsView studentId={id} />
        ) : scope === "quiz" ? (
          <QuizAnalyticsView quizId={id} classId={filterClassId} />
        ) : (
          <ClassAnalyticsView classId={id} />
        )}
      </Suspense>
    </div>
  );
}

function ViewSkeleton() {
  return (
    <div className="glass flex items-center justify-center gap-2 p-12 text-sm text-[var(--body-subtle)]">
      <Spinner size={20} />
      טוען נתונים…
    </div>
  );
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/ui/BackLink";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { AnalyticsSearch } from "@/components/teacher/analytics/AnalyticsSearch";
import { ClassAnalyticsView } from "@/components/teacher/analytics/ClassAnalyticsView";
import { ClassQuizAnalyticsView } from "@/components/teacher/analytics/ClassQuizAnalyticsView";
import { StudentAnalyticsView } from "@/components/teacher/analytics/StudentAnalyticsView";
import { QuizAnalyticsView } from "@/components/teacher/analytics/QuizAnalyticsView";
import { classAnalyticsHref } from "@/components/teacher/analyticsLinks";
import { getClassName } from "@/lib/classes";
import type { AnalyticsScope } from "@/lib/analytics";

/**
 * The analytics hub.
 *
 * ONE route renders every analytics view, selected by the URL:
 * `/dashboard/analytics?scope=student|class|quiz&id=<uuid>`. That contract is
 * what the rest of the app links into — `components/teacher/analyticsLinks.ts`
 * builds every such href — so it is deliberately narrow and deliberately
 * stable: a scope plus an id, nothing positional, nothing nested. A view is
 * therefore linkable, refresh-safe, and shareable, while the search QUERY stays
 * client state, because turning every keystroke into a server navigation would
 * be the wrong trade for something nobody bookmarks.
 *
 * The class scope takes one optional drill-down, `&quiz=<uuid>`, for a single
 * quiz's numbers inside that class. It hangs off the class rather than off the
 * quiz because its RPC is gated on teaching the class, not on authoring the
 * quiz: a teacher running a colleague's shared quiz can read it, and could not
 * read the quiz's own cross-class view.
 *
 * `scope` is validated and both ids must look like a uuid, so a hand-edited URL
 * lands on the search screen (or the undrilled class) rather than a failed read.
 *
 * Back normally goes up one level: to the class for a drill-down, and otherwise
 * to the search screen for the same scope. A link from outside analytics (the
 * overview's class cards) names its own origin instead, so it does not strand
 * the reader on a search box.
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
  // Only the class scope drills down; a `quiz` param anywhere else is ignored
  // rather than redirected, so a stray one degrades to the plain view.
  const drilledQuizId = scope === "class" ? normalizeId(params.quiz) : null;

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

  // The class's own name, when it's the selected entity — read separately from
  // (and ahead of) the heavier view fetch below, so the header can name the
  // class instantly instead of waiting on the Suspense boundary. It names the
  // header in a quiz drill-down too, where the quiz's own title belongs to the
  // view. Falls back to the generic title if the lookup fails.
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
        {drilledQuizId ? (
          <BackLink
            href={classAnalyticsHref(id)}
            label="אנליטיקה של הכיתה"
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
        key={`${scope}:${id}:${drilledQuizId ?? ""}`}
        fallback={<ViewSkeleton />}
      >
        {scope === "student" ? (
          <StudentAnalyticsView studentId={id} />
        ) : scope === "quiz" ? (
          <QuizAnalyticsView quizId={id} />
        ) : drilledQuizId ? (
          <ClassQuizAnalyticsView classId={id} quizId={drilledQuizId} />
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

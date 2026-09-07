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
import {
  CLASS_ORIGIN,
  STUDENT_ORIGIN,
  classAnalyticsHref,
  quizAnalyticsHref,
  studentAnalyticsHref,
} from "@/components/teacher/analyticsLinks";
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

  // A reader who drilled into this quiz from a class or a student says so with
  // `from=`, and back belongs at that entity rather than at the quiz rollup. The
  // class dropdown deliberately sets neither: once the reader has switched class
  // under their own steam, back belongs at the quiz. See `QuizClassFilter`.
  //
  // The class id is already in the URL; a student's rides along in `&student=`,
  // and is validated like any other id so a hand-edited one lands nowhere.
  const rawFrom = Array.isArray(params.from) ? params.from[0] : params.from;
  const onQuiz = scope === "quiz";
  const backToClassId =
    onQuiz && filterClassId && rawFrom === CLASS_ORIGIN ? filterClassId : null;
  const backToStudentId =
    onQuiz && rawFrom === STUDENT_ORIGIN ? normalizeId(params.student) : null;

  // One lookup serves both: the class-scope title, and the back link's label
  // when returning to a class. Named rather than generic, because the whole
  // point of this affordance is telling the reader where they will land.
  let className: string | null = null;
  if (scope === "class" || backToClassId) {
    const client = (await createClient()) as unknown as SupabaseClient;
    try {
      className = await getClassName(client, backToClassId ?? id);
    } catch {
      className = null;
    }
  }

  let title = SCOPE_TITLE[scope];
  if (scope === "class" && className) title = `אנליטיקה של ${className}`;

  return (
    <div className="mx-auto max-w-6xl py-2">
      <header className="mb-6 flex flex-col gap-2">
        {backToClassId ? (
          <BackLink
            href={classAnalyticsHref(backToClassId)}
            label={className ? `אנליטיקה של ${className}` : "אנליטיקה של הכיתה"}
          />
        ) : backToStudentId ? (
          // Generic wording: the page has no cheap name lookup for a student the
          // way `getClassName` serves a class, and the student scope's own title
          // is generic for the same reason.
          <BackLink
            href={studentAnalyticsHref(backToStudentId)}
            label="אנליטיקה של התלמיד/ה"
          />
        ) : filterClassId ? (
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

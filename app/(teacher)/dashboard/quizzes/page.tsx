import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listMyQuizzes, type MyQuiz } from "@/lib/quiz";
import { listSharedQuizzes, type SharedQuiz } from "@/lib/sharing";
import { listMyQuizAllocationTags, type QuizAllocationTags } from "@/lib/allocations";
import { listMyClasses, type ClassRow } from "@/lib/classes";
import { normalizeStatusParam } from "@/lib/libraryFilters";
import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { QuizLibrary } from "@/components/teacher/library/QuizLibrary";

/**
 * The teacher's quiz library. The `status` param is the deep link the home
 * page's KPI tiles produce ("חידונים פעילים" / "חידונים שהסתיימו"): read here,
 * on the server, and handed to the client library as its initial filter value —
 * the shape this Next version prescribes for a server-rendered page whose
 * filtering is client-side (`useSearchParams` would force the whole library
 * under a Suspense boundary to say the same thing).
 */
export default async function QuizzesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const initialStatus = normalizeStatusParam((await searchParams).status);

  let myQuizzes: MyQuiz[] = [];
  let sharedQuizzes: SharedQuiz[] = [];
  let allocationTags: Record<string, QuizAllocationTags> = {};
  let classes: ClassRow[] = [];
  let failed = false;

  try {
    const client = (await createClient()) as unknown as SupabaseClient;
    const [myQuizzesResult, sharedQuizzesResult, tags, classesResult] = await Promise.all([
      listMyQuizzes(client),
      listSharedQuizzes(client),
      listMyQuizAllocationTags(client),
      listMyClasses(client),
    ]);
    myQuizzes = myQuizzesResult;
    sharedQuizzes = sharedQuizzesResult;
    allocationTags = Object.fromEntries(tags.map((t) => [t.quiz_id, t]));
    // The class-assignment filter's option list — the teacher's full roster,
    // not just classes that already have a quiz assigned, so a class with 0
    // quizzes still exists as a (correctly empty-yielding) filter option.
    classes = classesResult;
  } catch {
    failed = true;
  }

  return (
    <div className="mx-auto max-w-6xl py-2">
      {/* The page's one affirmative action lives in the header, next to the
          title, instead of floating above the grid — it belongs to the page,
          not to whichever tab happens to be open. */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-3xl font-bold tracking-tight">החידונים שלי</h1>
          <p className="text-[var(--body)]">
            נהלו את החידונים שלכם ושכפלו חידונים ממאגר בית הספר.
          </p>
        </div>
        <Link href="/dashboard/quizzes/new">
          <Button size="lg">
            <Icon name="plus" size={18} />
            חידון חדש
          </Button>
        </Link>
      </header>
      {failed ? (
        <Alert variant="danger">לא ניתן לטעון את החידונים. נסו לרענן.</Alert>
      ) : (
        <QuizLibrary
          // Re-keyed by the deep-linked status so arriving from a different
          // KPI tile (or losing the param entirely) starts the filter bar
          // over, instead of leaving the previous tile's filter in place with
          // nothing in the URL to explain it.
          key={initialStatus}
          myQuizzes={myQuizzes}
          sharedQuizzes={sharedQuizzes}
          allocationTags={allocationTags}
          classes={classes}
          initialStatus={initialStatus}
        />
      )}
    </div>
  );
}

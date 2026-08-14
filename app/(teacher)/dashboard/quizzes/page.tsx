import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listMyQuizzes, type MyQuiz } from "@/lib/quiz";
import { listSharedQuizzes, type SharedQuiz } from "@/lib/sharing";
import { listMyQuizAllocationTags, type QuizAllocationTags } from "@/lib/allocations";
import { listMyClasses, type ClassRow } from "@/lib/classes";
import { Alert } from "@/components/ui/Alert";
import { QuizLibrary } from "@/components/teacher/library/QuizLibrary";

export default async function QuizzesPage() {
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
      <h1 className="mb-1 text-3xl font-bold tracking-tight">החידונים שלי</h1>
      <p className="mb-6 text-[var(--body)]">
        נהלו את החידונים שלכם ושכפלו חידונים ממאגר בית הספר.
      </p>
      {failed ? (
        <Alert variant="danger">לא ניתן לטעון את החידונים. נסו לרענן.</Alert>
      ) : (
        <QuizLibrary
          myQuizzes={myQuizzes}
          sharedQuizzes={sharedQuizzes}
          allocationTags={allocationTags}
          classes={classes}
        />
      )}
    </div>
  );
}

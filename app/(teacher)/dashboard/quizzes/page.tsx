import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listMyQuizzes, type MyQuiz } from "@/lib/quiz";
import { listSharedQuizzes, type SharedQuiz } from "@/lib/sharing";
import { Alert } from "@/components/ui/Alert";
import { QuizLibrary } from "@/components/teacher/library/QuizLibrary";

export default async function QuizzesPage() {
  let myQuizzes: MyQuiz[] = [];
  let sharedQuizzes: SharedQuiz[] = [];
  let failed = false;

  try {
    const client = (await createClient()) as unknown as SupabaseClient;
    [myQuizzes, sharedQuizzes] = await Promise.all([
      listMyQuizzes(client),
      listSharedQuizzes(client),
    ]);
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
        <QuizLibrary myQuizzes={myQuizzes} sharedQuizzes={sharedQuizzes} />
      )}
    </div>
  );
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getQuizForAuthor, QuizAuthorError, type AuthorQuiz } from "@/lib/quizAuthor";
import { listMyClasses, type ClassRow } from "@/lib/classes";
import { listQuizAllocations, type QuizAllocation } from "@/lib/allocations";
import { Alert } from "@/components/ui/Alert";
import { BackLink } from "@/components/ui/BackLink";
import { QuizEditor } from "@/components/teacher/editor/QuizEditor";
import { TranscriptWarmer } from "@/components/TranscriptWarmer";

/**
 * Quiz editor: reads the full editable tree via the owner-checked
 * `get_quiz_for_author` RPC and hands it to the client `QuizEditor`. A quiz the
 * caller doesn't own surfaces as `not_owner` and degrades to a friendly notice
 * rather than crashing. Also reads the teacher's classes (isolated — a
 * failure here degrades the allocations section rather than the whole page)
 * so the allocations section can offer bulk-assign candidates.
 *
 * The library is only one of the ways in — the overview's quiz row, the
 * new-quiz flow and the analytics hub all open the editor too — so back follows
 * the origin in the URL when there is one.
 */
export default async function EditQuizPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const client = (await createClient()) as unknown as SupabaseClient;

  const backLink = (
    <div className="mb-4">
      <BackLink href="/dashboard/quizzes" label="החידונים שלי" from={from} />
    </div>
  );

  let quiz: AuthorQuiz | null = null;
  let notOwner = false;
  let failed = false;
  try {
    quiz = await getQuizForAuthor(client, id);
  } catch (e) {
    // `get_quiz_for_author` raises `not_owner` for a non-owner or an unknown
    // quiz; QuizAuthorError.code carries that stable code.
    if (e instanceof QuizAuthorError && e.code === "not_owner") {
      notOwner = true;
    } else {
      failed = true;
    }
  }

  if (notOwner || !quiz) {
    return (
      <div className="mx-auto max-w-4xl py-2">
        {backLink}
        {failed ? (
          <Alert variant="danger" title="לא ניתן לטעון את החידון">
            אירעה שגיאה בטעינת החידון. נסו לרענן את הדף.
          </Alert>
        ) : (
          <Alert variant="warning" title="החידון לא נמצא">
            החידון אינו קיים או שאינו שייך לך.
          </Alert>
        )}
      </div>
    );
  }

  let classes: ClassRow[] = [];
  try {
    classes = await listMyClasses(client);
  } catch {
    classes = [];
  }

  let allocations: QuizAllocation[] = [];
  try {
    allocations = await listQuizAllocations(client, id);
  } catch {
    allocations = [];
  }

  return (
    <div className="mx-auto max-w-4xl py-2">
      {backLink}
      {/* Warm the transcript now so "generate with AI" has it ready rather than
          starting a cold fetch while the teacher waits on a spinner. */}
      <TranscriptWarmer quizId={id} />
      <QuizEditor initial={quiz} classes={classes} allocations={allocations} />
    </div>
  );
}

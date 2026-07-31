import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getQuizForAuthor, QuizAuthorError, type AuthorQuiz } from "@/lib/quizAuthor";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/ui/Icon";
import { QuizEditor } from "@/components/teacher/editor/QuizEditor";

/**
 * Quiz editor: reads the full editable tree via the owner-checked
 * `get_quiz_for_author` RPC and hands it to the client `QuizEditor`. A quiz the
 * caller doesn't own surfaces as `not_owner` and degrades to a friendly notice
 * rather than crashing.
 */
export default async function EditQuizPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = (await createClient()) as unknown as SupabaseClient;

  const backLink = (
    <Link
      href="/dashboard/quizzes"
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--fg-brand)] hover:underline"
    >
      <Icon name="arrow" size={16} />
      חזרה לחידונים שלי
    </Link>
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

  return (
    <div className="mx-auto max-w-4xl py-2">
      {backLink}
      <QuizEditor initial={quiz} />
    </div>
  );
}

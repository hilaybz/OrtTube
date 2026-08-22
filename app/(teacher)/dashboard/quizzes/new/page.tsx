import { BackLink } from "@/components/ui/BackLink";
import { isBackTargetKey, type BackTargetKey } from "@/components/ui/backTarget";
import { NewQuizForm } from "@/components/teacher/editor/NewQuizForm";

/**
 * Create a quiz from a YouTube URL. The form upserts the canonical video and the
 * quiz, then routes to the editor; transcript fetching is asynchronous and its
 * status surfaces in the editor.
 *
 * Reachable from the quiz library and from the overview's "+", so the origin is
 * read off the URL and handed both to the back link and to the form, which
 * passes it on to the editor — creating a quiz should not lose where the
 * teacher started.
 */
export default async function NewQuizPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { from } = await searchParams;
  const raw = Array.isArray(from) ? from[0] : from;
  const origin: BackTargetKey | undefined =
    raw && isBackTargetKey(raw) ? raw : undefined;

  return (
    <div className="mx-auto max-w-2xl py-2">
      <header className="mb-6 flex flex-col gap-2">
        <BackLink href="/dashboard/quizzes" label="החידונים שלי" from={origin} />
        <h1 className="text-3xl font-bold tracking-tight">חידון חדש</h1>
        <p className="text-[var(--body)]">
          שני שלבים: הסרטון שעליו נבנה החידון, והשם שהתלמידים יראו.
        </p>
      </header>
      <NewQuizForm from={origin} />
    </div>
  );
}

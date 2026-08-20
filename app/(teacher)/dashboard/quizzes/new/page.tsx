import { BackLink } from "@/components/ui/BackLink";
import { NewQuizForm } from "@/components/teacher/editor/NewQuizForm";

/**
 * Create a quiz from a YouTube URL. The form upserts the canonical video and the
 * quiz, then routes to the editor; transcript fetching is asynchronous and its
 * status surfaces in the editor.
 */
export default function NewQuizPage() {
  return (
    <div className="mx-auto max-w-2xl py-2">
      <header className="mb-6 flex flex-col gap-2">
        <BackLink href="/dashboard/quizzes" label="החידונים שלי" />
        <h1 className="text-3xl font-bold tracking-tight">חידון חדש</h1>
        <p className="text-[var(--body)]">
          שני שלבים: הסרטון שעליו נבנה החידון, והשם שהתלמידים יראו.
        </p>
      </header>
      <NewQuizForm />
    </div>
  );
}

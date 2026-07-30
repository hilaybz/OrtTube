import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { NewQuizForm } from "@/components/teacher/editor/NewQuizForm";

/**
 * Create a quiz from a YouTube URL. The form upserts the canonical video and the
 * quiz, then routes to the editor; transcript fetching is asynchronous and its
 * status surfaces in the editor.
 */
export default function NewQuizPage() {
  return (
    <div className="mx-auto max-w-2xl py-2">
      <Link
        href="/dashboard/quizzes"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--fg-brand)] hover:underline"
      >
        <Icon name="arrow" size={16} />
        חזרה לחידונים שלי
      </Link>
      <h1 className="mb-1 text-3xl font-bold tracking-tight">חידון חדש</h1>
      <p className="mb-6 text-[var(--body)]">
        הדביקו קישור לסרטון YouTube ובחרו את שפת המקור — נתחיל לבנות את החידון.
      </p>
      <NewQuizForm />
    </div>
  );
}

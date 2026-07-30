import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  listMyClasses,
  listClassRoster,
  listClassQuizzes,
  type ClassRow,
  type ClassRoster,
  type AssignedQuiz,
} from "@/lib/classes";
import { listMyQuizzes, type MyQuiz } from "@/lib/quiz";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { ClassHeaderActions } from "@/components/teacher/classes/ClassHeaderActions";
import { ClassTabs } from "@/components/teacher/classes/ClassTabs";
import { LANGUAGE_LABELS } from "@/components/teacher/classes/labels";

/**
 * Class detail: header (name + language) with owner rename/delete controls, then
 * tabbed roster + assigned-quizzes management. `listMyClasses` doubles as the
 * ownership/existence check (a class the caller doesn't own is simply absent).
 * Each read is isolated so a transient failure degrades to a friendly Alert
 * instead of crashing the page.
 */
export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = (await createClient()) as unknown as SupabaseClient;

  const backLink = (
    <Link
      href="/dashboard/classes"
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--fg-brand)] hover:underline"
    >
      <Icon name="arrow" size={16} />
      חזרה לכיתות
    </Link>
  );

  let klass: ClassRow | null = null;
  let lookupFailed = false;
  try {
    const classes = await listMyClasses(client);
    klass = classes.find((c) => c.id === id) ?? null;
  } catch {
    lookupFailed = true;
  }

  if (lookupFailed) {
    return (
      <div className="mx-auto max-w-5xl py-2">
        {backLink}
        <Alert variant="danger" title="לא ניתן לטעון את הכיתה">
          אירעה שגיאה בטעינת הכיתה. נסו לרענן את הדף.
        </Alert>
      </div>
    );
  }

  if (!klass) {
    return (
      <div className="mx-auto max-w-5xl py-2">
        {backLink}
        <Alert variant="warning" title="הכיתה לא נמצאה">
          הכיתה אינה קיימת או שאינה שייכת לך.
        </Alert>
      </div>
    );
  }

  let roster: ClassRoster = { members: [], invites: [] };
  let assigned: AssignedQuiz[] = [];
  let myQuizzes: MyQuiz[] = [];
  let dataFailed = false;
  try {
    [roster, assigned, myQuizzes] = await Promise.all([
      listClassRoster(client, id),
      listClassQuizzes(client, id),
      listMyQuizzes(client),
    ]);
  } catch {
    dataFailed = true;
  }

  return (
    <div className="mx-auto max-w-5xl py-2">
      {backLink}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="truncate text-3xl font-bold tracking-tight">
            {klass.name}
          </h1>
          <Badge variant="gray">
            <Icon name="class" size={12} />
            {LANGUAGE_LABELS[klass.language]}
          </Badge>
        </div>
        <ClassHeaderActions
          classId={klass.id}
          name={klass.name}
          language={klass.language}
        />
      </div>

      {dataFailed ? (
        <Alert variant="danger" title="לא ניתן לטעון את נתוני הכיתה">
          אירעה שגיאה בטעינת רשימת התלמידים והחידונים. נסו לרענן את הדף.
        </Alert>
      ) : (
        <ClassTabs
          classId={klass.id}
          roster={roster}
          assigned={assigned}
          myQuizzes={myQuizzes}
        />
      )}
    </div>
  );
}

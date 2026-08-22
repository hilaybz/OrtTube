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
import { IconLink } from "@/components/ui/IconButton";
import { BackLink } from "@/components/ui/BackLink";
import { ClassHeaderActions } from "@/components/teacher/classes/ClassHeaderActions";
import { ClassTabs } from "@/components/teacher/classes/ClassTabs";
import { LANGUAGE_LABELS } from "@/components/teacher/classes/labels";
import { classAnalyticsHref } from "@/components/teacher/analyticsLinks";

const BACK_HREF = "/dashboard/classes";
const BACK_LABEL = "הכיתות שלי";

/**
 * Class detail: header (name + language) with the owner's rename control and a
 * link into the class's analytics, then tabbed quizzes + roster.
 * `listMyClasses` doubles as the ownership/existence check (a class the caller
 * doesn't own is simply absent). Each read is isolated so a transient failure
 * degrades to a friendly Alert instead of crashing the page.
 *
 * The class list is the usual way in, but the overview's class cards open this
 * page too, so back follows the origin in the URL when there is one.
 */
export default async function ClassDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const client = (await createClient()) as unknown as SupabaseClient;

  let klass: ClassRow | null = null;
  let lookupFailed = false;
  try {
    const classes = await listMyClasses(client);
    klass = classes.find((c) => c.id === id) ?? null;
  } catch {
    lookupFailed = true;
  }

  if (lookupFailed || !klass) {
    return (
      <div className="mx-auto max-w-5xl py-2">
        <BackLink href={BACK_HREF} label={BACK_LABEL} from={from} className="mb-4" />
        {lookupFailed ? (
          <Alert variant="danger" title="לא ניתן לטעון את הכיתה">
            אירעה שגיאה בטעינת הכיתה. נסו לרענן את הדף.
          </Alert>
        ) : (
          <Alert variant="warning" title="הכיתה לא נמצאה">
            הכיתה אינה קיימת או שאינה שייכת לך.
          </Alert>
        )}
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
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <BackLink href={BACK_HREF} label={BACK_LABEL} from={from} />
          <h1 className="truncate text-3xl font-bold tracking-tight">
            {klass.name}
          </h1>
          <Badge variant="gray">
            <Icon name="class" size={12} />
            {LANGUAGE_LABELS[klass.language]}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconLink
            name="chart"
            label="אנליטיקה של הכיתה"
            href={classAnalyticsHref(klass.id)}
            tooltipPlacement="bottom"
          />
          <ClassHeaderActions
            classId={klass.id}
            name={klass.name}
            language={klass.language}
          />
        </div>
      </header>

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

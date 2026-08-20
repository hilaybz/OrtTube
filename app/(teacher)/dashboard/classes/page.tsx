import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listMyClasses, type ClassRow } from "@/lib/classes";
import { GlassCard } from "@/components/ui/GlassCard";
import { Alert } from "@/components/ui/Alert";
import { ClassGrid } from "@/components/teacher/classes/ClassGrid";
import { CreateClassButton } from "@/components/teacher/classes/CreateClassButton";

/**
 * Teacher's classes index: the classes they own, each linking to its detail
 * page, plus a "כיתה חדשה" create action. Reads run through the caller's
 * session so RLS scopes the list to the signed-in teacher; a read failure
 * degrades to a friendly Alert.
 */
export default async function ClassesPage() {
  const client = (await createClient()) as unknown as SupabaseClient;

  let classes: ClassRow[] = [];
  let failed = false;
  try {
    classes = await listMyClasses(client);
  } catch {
    failed = true;
  }

  return (
    <div className="mx-auto max-w-6xl py-2">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-3xl font-bold tracking-tight">הכיתות שלי</h1>
          <p className="text-[var(--body)]">
            מעקב אחר התלמידים והקצאת חידונים.
          </p>
        </div>
        <CreateClassButton />
      </div>

      {failed ? (
        <Alert variant="danger" title="לא ניתן לטעון את הכיתות">
          אירעה שגיאה בטעינת הכיתות שלך. נסו לרענן את הדף.
        </Alert>
      ) : classes.length === 0 ? (
        <GlassCard className="flex flex-col items-start gap-4">
          <p className="text-[var(--body)]">
            עדיין אין לך כיתות. צרו כיתה כדי להקצות לה חידונים.
          </p>
          <CreateClassButton />
        </GlassCard>
      ) : (
        <ClassGrid classes={classes} />
      )}
    </div>
  );
}

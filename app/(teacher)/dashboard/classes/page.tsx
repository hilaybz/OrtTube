import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listMyClasses, type ClassRow } from "@/lib/classes";
import { GlassCard } from "@/components/ui/GlassCard";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { CreateClassButton } from "@/components/teacher/classes/CreateClassButton";
import { LANGUAGE_LABELS } from "@/components/teacher/classes/labels";

/**
 * Teacher's classes index: a grid of the classes they own, each linking to its
 * detail page, plus a "כיתה חדשה" create action. Reads run through the caller's
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
            ניהול כיתות, רשימות תלמידים והקצאת חידונים.
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
            עדיין אין לך כיתות. צרו כיתה כדי לצרף תלמידים ולהקצות חידונים.
          </p>
          <CreateClassButton />
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c) => (
            <Link
              key={c.id}
              href={`/dashboard/classes/${c.id}`}
              className="group block focus-visible:outline-none"
            >
              <GlassCard
                interactive
                className="flex h-full items-start justify-between gap-3"
              >
                <div className="flex min-w-0 flex-col gap-2">
                  <h2 className="truncate text-lg font-semibold text-[var(--heading)]">
                    {c.name}
                  </h2>
                  <Badge variant="gray">
                    <Icon name="class" size={12} />
                    {LANGUAGE_LABELS[c.language]}
                  </Badge>
                </div>
                <Icon
                  name="arrow"
                  size={18}
                  className="mt-1 shrink-0 text-[var(--fg-brand)]"
                />
              </GlassCard>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

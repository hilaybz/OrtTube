import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  listMyClasses,
  listClassQuizzes,
  countClassMembers,
  type ClassRow,
  type AssignedQuiz,
} from "@/lib/classes";
import { getMyProfile } from "@/lib/profile";
import { listMyQuizzes, type MyQuiz } from "@/lib/quiz";
import { listMyQuizAllocationTags, type QuizAllocationTags } from "@/lib/allocations";
import { GlassCard } from "@/components/ui/GlassCard";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/ui/Icon";
import { withBackTarget } from "@/components/ui/backTarget";
import { StatTile } from "@/components/teacher/StatTile";
import { QuizCard } from "@/components/teacher/QuizCard";
import { ClassCard } from "@/components/teacher/overview/ClassCard";
import { WelcomeHeader } from "@/components/teacher/overview/WelcomeHeader";
import { ScrollRow, ScrollRowItem } from "@/components/teacher/overview/ScrollRow";
import { FinishedQuizCard } from "@/components/teacher/overview/FinishedQuizCard";
import { firstName } from "@/lib/datetime";
import {
  countQuizStates,
  recentlyFinishedQuizzes,
  summarizeClass,
  totalsFromSummaries,
  RECENTLY_FINISHED_LOOKBACK_DAYS,
  type ClassAssignments,
} from "@/components/teacher/overview/aggregate";

export default async function DashboardPage() {
  const client = (await createClient()) as unknown as SupabaseClient;
  const now = new Date();

  const [profile, classResult, allocatedQuizzes] = await Promise.all([
    loadGreetingName(client),
    loadClasses(client),
    loadActiveQuizzes(client),
  ]);

  if (classResult.failed) {
    return (
      <OverviewFrame name={profile} subtitle="נסו לרענן את הדף." now={now}>
        <Alert variant="danger" title="לא ניתן לטעון את הנתונים">
          אירעה שגיאה בטעינת הכיתות שלך. נסו לרענן את הדף.
        </Alert>
      </OverviewFrame>
    );
  }

  const classes = classResult.classes;

  if (classes.length === 0) {
    return (
      <OverviewFrame
        name={profile}
        subtitle="נתחיל מכיתה — אחריה תוכלו להקצות חידונים ולעקוב אחר ההתקדמות."
        now={now}
      >
        <GlassCard className="flex flex-col items-start gap-4">
          <p className="text-[var(--body)]">
            עדיין אין לך כיתות. צרו כיתה כדי להתחיל להקצות חידונים ולעקוב אחר
            ההתקדמות.
          </p>
          <Link
            href="/dashboard/classes"
            className="inline-flex items-center gap-2 rounded-[var(--radius)] bg-[var(--brand)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-strong)]"
          >
            <Icon name="class" size={16} />
            צרו כיתה כדי להתחיל
          </Link>
        </GlassCard>
      </OverviewFrame>
    );
  }

  const [memberCounts, assignments] = await Promise.all([
    loadMemberCounts(client, classes),
    loadAssignments(client, classes),
  ]);

  // `assignments` is built by mapping over `classes`, so index i is the same
  // class in both arrays — each summary pairs a class with its own allocations.
  const summaries = classes.map((c, i) =>
    summarizeClass(c, memberCounts.get(c.id) ?? 0, assignments[i].quizzes, now)
  );
  const totals = totalsFromSummaries(summaries, countQuizStates(assignments, now));
  const finished = recentlyFinishedQuizzes(assignments, now);

  return (
    <OverviewFrame name={profile} subtitle={subtitleFor(totals.openQuizzes)} now={now}>
      <div className="flex flex-col gap-8">
        <section aria-label="נתונים כלליים">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="כיתות"
              value={totals.classCount}
              icon="class"
              href="/dashboard/classes"
            />
            <StatTile label="תלמידים" value={totals.studentCount} icon="users" />
            <StatTile
              label="חידונים פעילים"
              value={totals.openQuizzes}
              icon="play"
              href="/dashboard/quizzes?status=active"
            />
            <StatTile
              label="חידונים שהסתיימו"
              value={totals.finishedQuizzes}
              icon="checkCircle"
              href="/dashboard/quizzes?status=finished"
            />
          </div>
        </section>

        {finished.length > 0 && (
          <section>
            <SectionHeading
              title="הסתיימו לאחרונה"
              hint={`חידונים שנסגרו ב-${RECENTLY_FINISHED_LOOKBACK_DAYS} הימים האחרונים`}
            />
            <ScrollRow label="חידונים שהסתיימו לאחרונה">
              {finished.map((quiz) => (
                <ScrollRowItem key={quiz.key}>
                  <FinishedQuizCard quiz={quiz} now={now} />
                </ScrollRowItem>
              ))}
            </ScrollRow>
          </section>
        )}

        <section>
          <SectionHeading title="החידונים הפעילים שלי" />
          {allocatedQuizzes.length === 0 ? (
            <GlassCard>
              <p className="text-[var(--body)]">
                עדיין לא הקציתם חידון לאף כיתה.{" "}
                <Link
                  href="/dashboard/quizzes"
                  className="font-medium text-[var(--fg-brand)] underline hover:no-underline"
                >
                  עברו לספריית החידונים
                </Link>{" "}
                כדי להקצות אחד.
              </p>
            </GlassCard>
          ) : (
            <ScrollRow label="החידונים הפעילים שלי">
              {allocatedQuizzes.map(({ quiz, tags }) => (
                <ScrollRowItem key={quiz.quiz_id}>
                  <QuizCard
                    quiz={quiz}
                    tags={tags}
                    href={withBackTarget(
                      `/dashboard/quizzes/${quiz.quiz_id}/edit`,
                      "overview"
                    )}
                  />
                </ScrollRowItem>
              ))}
            </ScrollRow>
          )}
        </section>

        <section>
          <SectionHeading title="הכיתות שלי" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {summaries.map((s) => (
              <ClassCard key={s.id} summary={s} />
            ))}
          </div>
        </section>
      </div>
    </OverviewFrame>
  );
}

function OverviewFrame({
  name,
  subtitle,
  now,
  children,
}: {
  name: string | null;
  subtitle: string;
  now: Date;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 py-2">
      <WelcomeHeader name={name} subtitle={subtitle} now={now} />
      {children}
    </div>
  );
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="text-xl font-semibold text-[var(--heading)]">{title}</h2>
      {hint && <span className="text-xs text-[var(--body-subtle)]">{hint}</span>}
    </div>
  );
}

function subtitleFor(openQuizzes: number): string {
  if (openQuizzes === 0) return "אין כרגע חידון פעיל. זה זמן טוב להקצות אחד.";
  if (openQuizzes === 1) return "חידון אחד פעיל כרגע בכיתות שלך.";
  return `${openQuizzes} חידונים פעילים כרגע בכיתות שלך.`;
}

async function loadGreetingName(client: SupabaseClient): Promise<string | null> {
  try {
    const profile = await getMyProfile(client);
    return firstName(profile?.display_name ?? null);
  } catch {
    return null;
  }
}

async function loadClasses(
  client: SupabaseClient
): Promise<{ classes: ClassRow[]; failed: boolean }> {
  try {
    return { classes: await listMyClasses(client), failed: false };
  } catch {
    return { classes: [], failed: true };
  }
}

async function loadMemberCounts(
  client: SupabaseClient,
  classes: readonly ClassRow[]
): Promise<Map<string, number>> {
  try {
    return await countClassMembers(
      client,
      classes.map((c) => c.id)
    );
  } catch {
    return new Map();
  }
}

function loadAssignments(
  client: SupabaseClient,
  classes: readonly ClassRow[]
): Promise<ClassAssignments[]> {
  return Promise.all(
    classes.map(async (klass) => {
      let quizzes: AssignedQuiz[] = [];
      try {
        quizzes = await listClassQuizzes(client, klass.id);
      } catch {
        quizzes = [];
      }
      return { klass, quizzes };
    })
  );
}

/**
 * Quizzes live or scheduled to at least one class right now.
 * `listMyQuizAllocationTags` also returns an entry for a quiz whose allocations
 * are all drafts or closed (both arrays empty, for the library's "לא פעיל"
 * badge) — that's the wrong inclusion test for a section titled "active", so
 * this filters on the arrays themselves rather than mere presence in the map.
 */
async function loadActiveQuizzes(
  client: SupabaseClient
): Promise<{ quiz: MyQuiz; tags: QuizAllocationTags }[]> {
  try {
    const [myQuizzes, tags] = await Promise.all([
      listMyQuizzes(client),
      listMyQuizAllocationTags(client),
    ]);
    const tagsByQuizId = new Map(tags.map((t) => [t.quiz_id, t]));
    return myQuizzes
      .map((q) => ({ quiz: q, tags: tagsByQuizId.get(q.quiz_id) }))
      .filter(
        (entry): entry is { quiz: MyQuiz; tags: QuizAllocationTags } =>
          !!entry.tags &&
          (entry.tags.live.length > 0 || entry.tags.scheduled.length > 0)
      );
  } catch {
    return [];
  }
}

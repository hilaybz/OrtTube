"use client";
import { GlassCard } from "@/components/ui/GlassCard";
import { QuizCard } from "./QuizCard";
import type { StudentFeedItem } from "@/lib/classes";

/**
 * Sort the "not yet attempted" section by soonest deadline first — this
 * section answers "what do I need to do before I run out of time," so the
 * most urgent item belongs on top. No-deadline items carry no urgency, so
 * they sink to the end (newest-assigned-first among themselves).
 */
export function sortNotYetAttempted(items: StudentFeedItem[]): StudentFeedItem[] {
  return [...items].sort((a, b) => {
    const da = a.available_until ? new Date(a.available_until).getTime() : Infinity;
    const db = b.available_until ? new Date(b.available_until).getTime() : Infinity;
    if (da !== db) return da - db;
    return new Date(b.assigned_at).getTime() - new Date(a.assigned_at).getTime();
  });
}

/**
 * Sort the "finished" section by most recent activity first — this section
 * is a history view, so "what did I just do" is the natural read. A missed
 * quiz has no completion timestamp, so its window's own close time stands
 * in as "when it became finished."
 */
export function sortFinished(items: StudentFeedItem[]): StudentFeedItem[] {
  const activity = (item: StudentFeedItem): number => {
    const iso = item.status === "missed" ? item.available_until : item.last_completed_at;
    return iso ? new Date(iso).getTime() : 0;
  };
  return [...items].sort((a, b) => activity(b) - activity(a));
}

export function StudentFeed({ items }: { items: StudentFeedItem[] }) {
  const notYet = sortNotYetAttempted(
    items.filter((i) => i.status === "not_started" || i.status === "in_progress")
  );
  const finished = sortFinished(
    items.filter((i) => i.status === "completed" || i.status === "missed")
  );

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold text-[var(--heading)]">טרם ניסית</h2>
        {notYet.length === 0 ? (
          <GlassCard>
            <p className="text-[var(--body)]">
              עדיין אין חידונים שממתינים לך. חידונים חדשים שיוקצו לכיתות שלך יופיעו כאן.
            </p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {notYet.map((item) => (
              <QuizCard key={`${item.class_id}:${item.quiz_id}`} item={item} />
            ))}
          </div>
        )}
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold text-[var(--heading)]">הושלמו</h2>
        {finished.length === 0 ? (
          <GlassCard>
            <p className="text-[var(--body)]">
              עדיין לא סיימת אף חידון. אחרי שתשלימו ניסיון, הוא יופיע כאן.
            </p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {finished.map((item) => (
              <QuizCard key={`${item.class_id}:${item.quiz_id}`} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

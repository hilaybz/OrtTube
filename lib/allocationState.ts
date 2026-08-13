/**
 * Pure allocation-state derivation — deliberately its own leaf module with NO
 * imports. `lib/classes.ts` re-exports this for server-side convenience, but
 * client components MUST import it from here directly, not from
 * `@/lib/classes`: that module's `assignQuizToClass` pulls in
 * `ensureTranslation` from `@/lib/quiz` at module scope, which chains into
 * server-only code (`@/lib/supabase/service`, the Anthropic SDK). Importing
 * even one unrelated value export from `@/lib/classes` drags that whole
 * chain into the client bundle — Next.js correctly refuses to build it. A
 * type-only import from `@/lib/classes` is fine (types vanish at compile
 * time); a value import is not. This module has nothing to strip, so it's
 * always safe.
 */

/**
 * The four states an allocation can be in, derived purely from its stored
 * fields and the current time — never a SQL label, so it's unit-testable
 * without a DB. Mirrors the SQL `_allocation_is_live` predicate
 * (`128_class_quiz_scheduling_window.sql`); tests pin both to the same
 * boundary (`available_until === now` is `done`, not `live`: `>`, not `>=`)
 * so the two can't silently drift.
 */
export type AllocationState = "draft" | "scheduled" | "live" | "done";

export function allocationState(
  allocation: {
    published: boolean;
    available_from: string | null;
    available_until: string | null;
  },
  now: Date = new Date()
): AllocationState {
  if (!allocation.published) return "draft";
  const from = allocation.available_from ? new Date(allocation.available_from) : null;
  const until = allocation.available_until ? new Date(allocation.available_until) : null;
  if (from && from.getTime() > now.getTime()) return "scheduled";
  if (until && until.getTime() <= now.getTime()) return "done";
  return "live";
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "@/lib/lang";
import {
  ensureTranslation as defaultEnsureTranslation,
  type EnsureTranslationResult,
} from "@/lib/quiz";
import type { TranslationItem } from "@/lib/ai/translate";

/**
 * All mutations here run through the caller's AUTHENTICATED (RLS-subject) client
 * so `auth.uid()` resolves to the owning teacher (or the student, for the feed).
 * Only the assignment translation hook reaches for a service-role client, and it
 * does so lazily inside `ensureTranslation`.
 */

export class ClassError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "ClassError";
    this.code = code;
  }
}

function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new ClassError(res.error.message);
  return res.data;
}

async function requireUserId(client: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new ClassError("unauthorized");
  return user.id;
}

export interface ClassRow {
  id: string;
  teacher_id: string;
  school_id: string;
  name: string;
  language: Language;
  created_at: string;
}

export async function createClass(
  client: SupabaseClient,
  params: { name: string; language?: Language }
): Promise<ClassRow> {
  const userId = await requireUserId(client);
  const profile = unwrap(
    await client.from("profiles").select("school_id").eq("id", userId).single()
  ) as { school_id: string };

  const row = unwrap(
    await client
      .from("classes")
      .insert({
        teacher_id: userId,
        school_id: profile.school_id,
        name: params.name,
        ...(params.language ? { language: params.language } : {}),
      })
      .select("id, teacher_id, school_id, name, language, created_at")
      .single()
  );
  return row as unknown as ClassRow;
}

export async function updateClass(
  client: SupabaseClient,
  classId: string,
  patch: { name?: string; language?: Language }
): Promise<ClassRow> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.language !== undefined) update.language = patch.language;

  const row = unwrap(
    await client
      .from("classes")
      .update(update)
      .eq("id", classId)
      .select("id, teacher_id, school_id, name, language, created_at")
      .maybeSingle()
  );
  if (!row) throw new ClassError("class_not_found");
  return row as unknown as ClassRow;
}

export async function deleteClass(
  client: SupabaseClient,
  classId: string
): Promise<void> {
  unwrap(await client.from("classes").delete().eq("id", classId));
}

export async function listMyClasses(client: SupabaseClient): Promise<ClassRow[]> {
  const rows = unwrap(
    await client
      .from("classes")
      .select("id, teacher_id, school_id, name, language, created_at")
      .order("name")
  );
  return (rows as unknown as ClassRow[]) ?? [];
}

export async function listMyClassesRunningQuiz(
  client: SupabaseClient,
  quizId: string
): Promise<Pick<ClassRow, "id" | "name">[]> {
  const allocations = unwrap(
    await client.from("class_quizzes").select("class_id").eq("quiz_id", quizId)
  ) as { class_id: string }[] | null;

  const classIds = (allocations ?? []).map((a) => a.class_id);
  if (classIds.length === 0) return [];

  const rows = unwrap(
    await client.from("classes").select("id, name").in("id", classIds).order("name")
  );
  return (rows as unknown as Pick<ClassRow, "id" | "name">[]) ?? [];
}

export async function getClassName(
  client: SupabaseClient,
  classId: string
): Promise<string | null> {
  const row = unwrap(
    await client.from("classes").select("name").eq("id", classId).maybeSingle()
  );
  return (row as { name: string } | null)?.name ?? null;
}

export async function countClassMembers(
  client: SupabaseClient,
  classIds: readonly string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (classIds.length === 0) return counts;
  const rows = unwrap(
    await client
      .from("class_members")
      .select("class_id")
      .in("class_id", classIds as string[])
  ) as unknown as { class_id: string }[] | null;
  for (const row of rows ?? []) {
    counts.set(row.class_id, (counts.get(row.class_id) ?? 0) + 1);
  }
  return counts;
}

export type AddStudentResult =
  | { status: "added"; student_id: string }
  | { status: "invited"; email: string };

export async function addStudentToClass(
  client: SupabaseClient,
  classId: string,
  email: string
): Promise<AddStudentResult> {
  const data = unwrap(
    await client.rpc("add_student_to_class", {
      p_class_id: classId,
      p_email: email,
    })
  );
  return data as unknown as AddStudentResult;
}

export async function removeStudentFromClass(
  client: SupabaseClient,
  classId: string,
  studentId: string
): Promise<void> {
  unwrap(
    await client.rpc("remove_student_from_class", {
      p_class_id: classId,
      p_student_id: studentId,
    })
  );
}

export async function revokeInvite(
  client: SupabaseClient,
  classId: string,
  email: string
): Promise<void> {
  unwrap(
    await client.rpc("revoke_invite", { p_class_id: classId, p_email: email })
  );
}

export interface RosterMember {
  student_id: string;
  email: string;
  display_name: string | null;
  joined_at: string;
}
export interface RosterInvite {
  email: string;
  created_at: string;
}
export interface ClassRoster {
  members: RosterMember[];
  invites: RosterInvite[];
}

export async function listClassRoster(
  client: SupabaseClient,
  classId: string
): Promise<ClassRoster> {
  const data = unwrap(
    await client.rpc("list_class_roster", { p_class_id: classId })
  );
  const roster = (data as unknown as ClassRoster) ?? { members: [], invites: [] };
  return {
    members: roster.members ?? [],
    invites: roster.invites ?? [],
  };
}

export type TutorMode = "off" | "hints" | "full";

export interface AssignmentResult {
  class_id: string;
  quiz_id: string;
  tutor_mode: TutorMode;
  max_attempts: number | null;
  published: boolean;
  available_from: string | null;
  available_until: string | null;
  class_language: Language;
  base_language: Language;
}

/**
 * Re-exported from the dependency-free leaf module for server-side
 * convenience. Client components must import `allocationState` from
 * `@/lib/allocationState` directly rather than from here — see that module's
 * header comment for why (importing any value from this file pulls
 * `ensureTranslation`'s server-only chain into the client bundle).
 */
export { allocationState, type AllocationState } from "./allocationState";

export type EnsureTranslationFn = (
  quizId: string,
  language: Language,
  opts?: {
    client?: SupabaseClient;
    translate?: (
      items: TranslationItem[],
      from: Language,
      to: Language
    ) => Promise<Record<string, string>>;
    ttlSeconds?: number;
  }
) => Promise<EnsureTranslationResult>;

/**
 * The translation is intentionally non-fatal: any failure is swallowed so a
 * translation hiccup never fails the assignment (the reader path falls back to
 * base_language and re-fills lazily). When `class_language === base_language`
 * the hook is skipped entirely. Tests inject `opts.ensureTranslation` /
 * `opts.translate`; pass `opts.awaitTranslation=false` to fire-and-forget in a
 * long-lived server context.
 */
export async function assignQuizToClass(
  client: SupabaseClient,
  params: {
    classId: string;
    quizId: string;
    tutorMode?: TutorMode;
    maxAttempts?: number | null;
    published?: boolean;
    availableFrom?: string | null;
    availableUntil?: string | null;
  },
  opts?: {
    ensureTranslation?: EnsureTranslationFn;
    translate?: (
      items: TranslationItem[],
      from: Language,
      to: Language
    ) => Promise<Record<string, string>>;
    awaitTranslation?: boolean;
  }
): Promise<AssignmentResult> {
  const data = unwrap(
    await client.rpc("assign_quiz_to_class", {
      p_class_id: params.classId,
      p_quiz_id: params.quizId,
      p_tutor_mode: params.tutorMode ?? "hints",
      // `undefined` lets the SQL default (1) apply; explicit `null` = unlimited.
      p_max_attempts: params.maxAttempts === undefined ? 1 : params.maxAttempts,
      p_published: params.published ?? true,
      p_available_from: params.availableFrom ?? null,
      p_available_until: params.availableUntil ?? null,
    })
  );
  const result = data as unknown as AssignmentResult;

  const ensure = opts?.ensureTranslation ?? defaultEnsureTranslation;
  const awaitIt = opts?.awaitTranslation ?? true;
  if (result.class_language !== result.base_language) {
    const run = async () => {
      try {
        await ensure(result.quiz_id, result.class_language, {
          translate: opts?.translate,
        });
      } catch {
      }
    };
    if (awaitIt) {
      await run();
    } else {
      void run();
    }
  }

  return result;
}

export async function unassignQuiz(
  client: SupabaseClient,
  classId: string,
  quizId: string
): Promise<void> {
  unwrap(
    await client.rpc("unassign_quiz", { p_class_id: classId, p_quiz_id: quizId })
  );
}

export async function setClassQuizPublished(
  client: SupabaseClient,
  classId: string,
  quizId: string,
  published: boolean
): Promise<void> {
  unwrap(
    await client.rpc("set_class_quiz_published", {
      p_class_id: classId,
      p_quiz_id: quizId,
      p_published: published,
    })
  );
}

export async function setClassQuizSchedule(
  client: SupabaseClient,
  classId: string,
  quizId: string,
  schedule: { availableFrom: string | null; availableUntil: string | null }
): Promise<void> {
  unwrap(
    await client.rpc("set_class_quiz_schedule", {
      p_class_id: classId,
      p_quiz_id: quizId,
      p_available_from: schedule.availableFrom,
      p_available_until: schedule.availableUntil,
    })
  );
}

export interface AssignedQuiz {
  quiz_id: string;
  title: string | null;
  base_language: Language;
  visibility: "private" | "shared";
  video_id: string;
  youtube_video_id: string;
  video_title: string | null;
  tutor_mode: TutorMode;
  max_attempts: number | null;
  published: boolean;
  available_from: string | null;
  available_until: string | null;
  assigned_at: string;
  question_count: number;
  author_id: string;
  author_name: string | null;
  /**
   * Whether the viewing teacher authored this quiz. `false` means it's a
   * `shared` quiz assigned into this class by its owner (any same-school
   * teacher may assign a shared quiz — see `assign_quiz_to_class`) — the
   * quiz editor is off-limits (`not_owner`), so such rows route to a
   * read-only preview instead.
   */
  is_own: boolean;
}

export async function listClassQuizzes(
  client: SupabaseClient,
  classId: string
): Promise<AssignedQuiz[]> {
  const data = unwrap(
    await client.rpc("list_class_quizzes", { p_class_id: classId })
  );
  return (data as unknown as AssignedQuiz[]) ?? [];
}

/**
 * `not_started`/`in_progress` — no completed attempt yet (an unfinished one,
 * if any, puts it in `in_progress`). `completed` — at least one completed
 * attempt; the RPC reports the LATEST one's score, never the best of several.
 * `missed` — the allocation's window has closed and the student never
 * started it at all.
 */
export type StudentFeedStatus = "not_started" | "in_progress" | "completed" | "missed";

export interface StudentFeedItem {
  class_id: string;
  class_name: string;
  teacher_name: string | null;
  quiz_id: string;
  title: string | null;
  youtube_video_id: string;
  video_title: string | null;
  duration_seconds: number | null;
  time_restricted: boolean;
  duration_minutes: number | null;
  max_attempts: number | null;
  available_until: string | null;
  assigned_at: string;
  is_live: boolean;
  status: StudentFeedStatus;
  attempts_left: number | null;
  last_num_correct: number | null;
  last_num_questions: number | null;
  last_completed_at: string | null;
  resume_attempt_id: string | null;
}

export async function listStudentFeed(
  client: SupabaseClient
): Promise<StudentFeedItem[]> {
  const data = unwrap(await client.rpc("list_student_feed", {}));
  return (data as unknown as StudentFeedItem[]) ?? [];
}

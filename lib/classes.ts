import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "@/lib/lang";
import {
  ensureTranslation as defaultEnsureTranslation,
  type EnsureTranslationResult,
} from "@/lib/quiz";
import type { TranslationItem } from "@/lib/ai/translate";

/**
 * Class service layer. Thin, typed TypeScript wrappers over
 * the SECURITY DEFINER roster/assignment RPCs plus direct,
 * RLS-scoped class CRUD.
 *
 * Clients are typed as the un-parameterised `SupabaseClient` on purpose (same
 * convention as lib/quiz.ts / lib/video.ts): these functions compile independently
 * of `lib/supabase/types.ts` being regenerated for the RPCs this task adds.
 *
 * All mutations here run through the caller's AUTHENTICATED (RLS-subject) client
 * so `auth.uid()` resolves to the owning teacher (or the student, for the feed).
 * Only the assignment translation hook reaches for a service-role client, and it
 * does so lazily inside `ensureTranslation`.
 */

/** Stable error thrown when an RPC raises one of its documented codes. */
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

// ── Class CRUD (direct, RLS-scoped) ───────────────────────────────────────────

export interface ClassRow {
  id: string;
  teacher_id: string;
  school_id: string;
  name: string;
  language: Language;
  created_at: string;
}

/**
 * Create a class owned by the signed-in teacher. `school_id` is derived from the
 * caller's profile so the RLS insert check (`school_id = current_school_id()`)
 * always matches; the composite FK then keeps class.school_id = teacher.school_id.
 */
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

/** Update a class's name and/or language (owner-only via RLS). */
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

/** Delete a class (owner-only via RLS). Cascades members/invites/assignments. */
export async function deleteClass(
  client: SupabaseClient,
  classId: string
): Promise<void> {
  unwrap(await client.from("classes").delete().eq("id", classId));
}

/** The signed-in teacher's own classes (owner-RLS scoped), alphabetical by name. */
export async function listMyClasses(client: SupabaseClient): Promise<ClassRow[]> {
  const rows = unwrap(
    await client
      .from("classes")
      .select("id, teacher_id, school_id, name, language, created_at")
      .order("name")
  );
  return (rows as unknown as ClassRow[]) ?? [];
}

// ── Roster (RPC) ──────────────────────────────────────────────────────────────

export type AddStudentResult =
  | { status: "added"; student_id: string }
  | { status: "invited"; email: string };

/**
 * Add a student to a class by email. Enrolls an existing same-school student, or
 * creates a pending invite (converted to membership on the student's signup by
 * the invite-conversion trigger). Raises `cross_school` for a different-school student and
 * `is_teacher` for a teacher's email.
 */
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

/** The class roster: enrolled members + pending invites (owner-only). */
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

// ── Assignment (RPC + eager translation hook) ─────────────────────────────────

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

/** Signature of the translation primitive (injectable for tests). */
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
 * Assign a quiz to a class with per-class `tutor_mode` + `max_attempts` +
 * `published` + an optional scheduling window, then best-effort
 * eager-translate the quiz into the class language (`ensureTranslation`).
 *
 * `published` defaults to `true` — omitting it keeps the pre-2A.1 behaviour of
 * assignment meaning instant visibility. Pass `false` to assign as a draft the
 * students in the class can't see until it's explicitly published.
 *
 * `availableFrom`/`availableUntil` default to `null` (no window — visible for
 * as long as `published` stays true). Both are ISO timestamps; the RPC
 * rejects `availableFrom >= availableUntil` with `invalid_schedule_window`.
 *
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
        // best-effort: a translation failure must not fail the assignment.
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

/**
 * Flip an existing assignment's published state without touching its
 * `tutor_mode` / `max_attempts`. Owner-checked the same way `unassignQuiz` is.
 */
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

/**
 * Edit an existing allocation's scheduling window without touching
 * `tutor_mode` / `max_attempts` / `published`. Same one-field-setter shape as
 * `setClassQuizPublished`, for the same reason: the editor/class-page row
 * actions are single-purpose, so a partial update never clobbers an unrelated
 * field. Pass `null` for either bound to clear it.
 */
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
}

/** Owner-facing list of a class's assigned (non-deleted) quizzes. */
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
 * started it at all (issue #69's student-side gap: this used to just vanish
 * from the feed instead of showing as missed).
 */
export type StudentFeedStatus = "not_started" | "in_progress" | "completed" | "missed";

export interface StudentFeedItem {
  class_id: string;
  class_name: string;
  /** The class owner's display name — the assigning teacher, which is NOT
   *  necessarily the quiz's author (a shared quiz can be assigned by any
   *  same-school teacher). Null if the teacher has no display_name set. */
  teacher_name: string | null;
  quiz_id: string;
  title: string | null;
  youtube_video_id: string;
  video_title: string | null;
  max_attempts: number | null;
  /** Null = no deadline. Past = the window has closed (see `status`). */
  available_until: string | null;
  assigned_at: string;
  /** Whether the allocation is currently open (`_allocation_is_live`) —
   *  drives the CTA on a `completed` card ("ניסיון נוסף" only while live). */
  is_live: boolean;
  status: StudentFeedStatus;
  /** Null = unlimited. */
  attempts_left: number | null;
  last_num_correct: number | null;
  last_num_questions: number | null;
  last_completed_at: string | null;
  /** The unfinished attempt to resume, when `status === "in_progress"`. */
  resume_attempt_id: string | null;
}

/**
 * The signed-in student's flat feed of assigned quizzes — live ones plus
 * recently-closed ones the student either completed or missed entirely.
 * Replaces the old per-class-tabbed `list_assigned_for_student` +
 * per-quiz `list_my_attempts_for_quiz` fan-out with one query.
 */
export async function listStudentFeed(
  client: SupabaseClient
): Promise<StudentFeedItem[]> {
  const data = unwrap(await client.rpc("list_student_feed", {}));
  return (data as unknown as StudentFeedItem[]) ?? [];
}

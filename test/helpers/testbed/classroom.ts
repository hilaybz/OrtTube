/**
 * Classroom handle: a class owned by a teacher. Its convenience methods act AS the
 * owner; when a different actor must operate on this class (to test the owner
 * guards), call the acting teacher's method with this classroom, e.g.
 * `peer.tryEnrollByEmail(biology, …)`.
 */
import type { Language } from "@/lib/lang";
import {
  updateClass,
  deleteClass,
  removeStudentFromClass,
  revokeInvite,
  listClassRoster,
  listClassQuizzes,
  type ClassRow,
  type ClassRoster,
  type AddStudentResult,
  type AssignedQuiz,
  type TutorMode,
  type EnsureTranslationFn,
} from "@/lib/classes";
import type { Teacher } from "./teacher";
import type { Student } from "./student";

export class Classroom {
  constructor(
    private row: ClassRow,
    readonly owner: Teacher
  ) {}

  get id(): string {
    return this.row.id;
  }
  get name(): string {
    return this.row.name;
  }
  get language(): Language {
    return this.row.language;
  }
  get teacherId(): string {
    return this.row.teacher_id;
  }
  get schoolId(): string {
    return this.row.school_id;
  }

  /** Enroll an existing same-school student by email. Returns the raw result. */
  enroll(student: Student): Promise<AddStudentResult> {
    return this.owner.tryEnrollByEmail(this, student.email);
  }

  /** Add someone by email — enrolls a known student or creates a pending invite. */
  addByEmail(email: string): Promise<AddStudentResult> {
    return this.owner.tryEnrollByEmail(this, email);
  }

  /** Remove a student (idempotent, owner-scoped). */
  removeStudent(student: Student): Promise<void> {
    return removeStudentFromClass(this.owner.client, this.id, student.id);
  }

  /** Revoke a pending invite by email (idempotent, owner-scoped). */
  revokeInvite(email: string): Promise<void> {
    return revokeInvite(this.owner.client, this.id, email);
  }

  /** The roster: enrolled members + pending invites. */
  roster(): Promise<ClassRoster> {
    return listClassRoster(this.owner.client, this.id);
  }

  /** Assigned, non-deleted quizzes (owner view). */
  assignedQuizzes(): Promise<AssignedQuiz[]> {
    return listClassQuizzes(this.owner.client, this.id);
  }

  /** Rename / relanguage the class (owner-only). Updates this handle in place. */
  async rename(patch: { name?: string; language?: Language }): Promise<ClassRow> {
    this.row = await updateClass(this.owner.client, this.id, patch);
    return this.row;
  }

  /** Delete the class (owner-only). Cascades members/invites/assignments. */
  delete(): Promise<void> {
    return deleteClass(this.owner.client, this.id);
  }
}

/** Options passed to a teacher assigning a quiz. */
export interface AssignOptions {
  to: Classroom;
  tutor?: TutorMode;
  maxAttempts?: number | null;
  /** Await the eager-translation hook (default false: assignment only). */
  awaitTranslation?: boolean;
  /** Inject the translation primitive to observe/stub the eager-translate hook. */
  ensureTranslation?: EnsureTranslationFn;
}

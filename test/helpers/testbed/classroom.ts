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

  enroll(student: Student): Promise<AddStudentResult> {
    return this.owner.tryEnrollByEmail(this, student.email);
  }

  addByEmail(email: string): Promise<AddStudentResult> {
    return this.owner.tryEnrollByEmail(this, email);
  }

  removeStudent(student: Student): Promise<void> {
    return removeStudentFromClass(this.owner.client, this.id, student.id);
  }

  revokeInvite(email: string): Promise<void> {
    return revokeInvite(this.owner.client, this.id, email);
  }

  roster(): Promise<ClassRoster> {
    return listClassRoster(this.owner.client, this.id);
  }

  assignedQuizzes(): Promise<AssignedQuiz[]> {
    return listClassQuizzes(this.owner.client, this.id);
  }

  async rename(patch: { name?: string; language?: Language }): Promise<ClassRow> {
    this.row = await updateClass(this.owner.client, this.id, patch);
    return this.row;
  }

  delete(): Promise<void> {
    return deleteClass(this.owner.client, this.id);
  }
}

export interface AssignOptions {
  to: Classroom;
  tutor?: TutorMode;
  maxAttempts?: number | null;
  published?: boolean;
  availableFrom?: string | null;
  availableUntil?: string | null;
  awaitTranslation?: boolean;
  ensureTranslation?: EnsureTranslationFn;
}

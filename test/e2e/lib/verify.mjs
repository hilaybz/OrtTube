/**
 * Out-of-band Verifier for the e2e DSL.
 *
 * Wraps SERVICE-ROLE supabase reads used ONLY to assert on / drive from state the
 * student HTTP surface intentionally hides — the answer key (to submit a perfect
 * score), the invite→membership conversion, the logged tutor question. Never used
 * as the app's auth and never to stand in for a missing HTTP route.
 */
import { createClient } from "@supabase/supabase-js";

export class Verifier {
  constructor(supabaseUrl, serviceKey) {
    this.svc = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /** Map<questionId, correctOptionIds[]> for the given questions (live options only). */
  async answerKeyFor(questionIds) {
    const { data, error } = await this.svc
      .from("question_options")
      .select("id, question_id, is_correct, deleted_at")
      .in("question_id", questionIds);
    if (error) throw new Error(`OOB answer-key read failed: ${error.message}`);
    const key = new Map();
    for (const row of data) {
      if (row.deleted_at || !row.is_correct) continue;
      if (!key.has(row.question_id)) key.set(row.question_id, []);
      key.get(row.question_id).push(row.id);
    }
    return key;
  }

  /** Live (non-deleted) questions of a quiz: [{ id, kind }]. */
  async liveQuestions(quizId) {
    const { data, error } = await this.svc
      .from("questions")
      .select("id, kind, deleted_at")
      .eq("quiz_id", quizId)
      .is("deleted_at", null);
    if (error) throw new Error(`OOB questions read failed: ${error.message}`);
    return data;
  }

  /** Count of pending invites for a class/email pair. */
  async pendingInviteCount(classId, email) {
    const { count } = await this.svc
      .from("class_invites")
      .select("*", { count: "exact", head: true })
      .eq("class_id", classId)
      .eq("email", email);
    return count || 0;
  }

  /** Count of membership rows for a class/student pair. */
  async membershipCount(classId, studentId) {
    const { count } = await this.svc
      .from("class_members")
      .select("*", { count: "exact", head: true })
      .eq("class_id", classId)
      .eq("student_id", studentId);
    return count || 0;
  }

  /** Count of logged tutor questions for a student/quiz pair. */
  async tutorQuestionCount(studentId, quizId) {
    const { count } = await this.svc
      .from("tutor_questions")
      .select("*", { count: "exact", head: true })
      .eq("student_id", studentId)
      .eq("quiz_id", quizId);
    return count || 0;
  }

  /** Poll (best-effort) until a tutor_questions row shows up; returns the count. */
  async waitForTutorQuestion(studentId, quizId, { tries = 10, delayMs = 300 } = {}) {
    let found = 0;
    for (let i = 0; i < tries; i++) {
      found = await this.tutorQuestionCount(studentId, quizId);
      if (found > 0) break;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return found;
  }

  /** Soft-delete a quiz OOB (housekeeping for unusable candidate quizzes). */
  async discardQuiz(quizId) {
    try {
      await this.svc
        .from("quizzes")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", quizId);
    } catch {
      /* best-effort cleanup */
    }
  }
}

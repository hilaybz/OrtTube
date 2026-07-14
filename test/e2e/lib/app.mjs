/**
 * Actor-based e2e DSL over the REAL Next.js HTTP API.
 *
 * Same actor vocabulary as the integration DSL (`test/helpers/world.ts`) but every
 * action is a real HTTP request with a per-actor cookie jar. The smoke script
 * reads as prose — who does what — while all fetch/cookie/parsing plumbing lives
 * in `http.mjs`, all out-of-band service-role reads in `verify.mjs`.
 *
 *   const app     = testApp(baseUrl);
 *   const teacher = await app.seedTeacher({ school: "Lincoln" }); await teacher.signIn();
 *   const biology = await teacher.createClass({ language: "he" });
 *   const quiz    = await teacher.createQuizOnVideo(videoId, "Quiz");
 *   await teacher.assign(quiz, { to: biology, maxAttempts: 1, tutor: "hints" });
 *   const student = await teacher.inviteStudent(biology, email);
 *   await student.signUp(); await student.signIn();
 *   const paper   = await student.openQuiz(quiz, biology);   // answer-free
 *   const attempt = await student.startAttempt(quiz, biology);
 *   await attempt.answerAllCorrectly();                      // key read OOB by the Verifier
 *   const result  = await attempt.complete();
 *
 * Network methods return a parsed envelope `{ status, text, ... }` so the caller
 * keeps ownership of every assertion; handle-returning methods (createClass,
 * inviteStudent, startAttempt) attach their raw response as `.response` for the
 * same reason. Nothing here asserts or weakens — it only moves bytes.
 */
import { CookieJar, request } from "./http.mjs";
import { Verifier } from "./verify.mjs";

class App {
  constructor({ baseUrl, adminSecret, supabaseUrl, serviceKey }) {
    this.baseUrl = baseUrl;
    this.adminSecret = adminSecret;
    this.ts = Date.now();
    /** Out-of-band Verifier (service role) — reads only, never drives auth. */
    this.verify = new Verifier(supabaseUrl, serviceKey);
  }

  req(jar, path, opts) {
    return request(this.baseUrl, jar, path, opts);
  }

  /** A unique-per-run email so repeated runs don't collide. */
  uniqueEmail(who) {
    return `smoke-${who}-${this.ts}@example.com`;
  }

  /**
   * Confirm the dev server answers. Returns true on any HTTP response; throws a
   * clear error if the socket can't be reached at all.
   */
  async serverReachable() {
    try {
      const res = await fetch(this.baseUrl, { redirect: "manual" });
      return res.status > 0;
    } catch (e) {
      throw new Error(
        `Cannot reach ${this.baseUrl}: ${e.message}. Is 'next dev' running?`
      );
    }
  }

  /**
   * Seed a school + teacher via POST /api/admin/seed-teacher (admin-authed, no
   * session). Returns a Teacher actor carrying its own cookie jar and the raw
   * seed response as `.seedResponse` for the caller to assert on.
   */
  async seedTeacher({ school, name = "Smoke Teacher", email, password = "smoke-pass-123" }) {
    const teacherEmail = email ?? this.uniqueEmail("teacher");
    const res = await this.req(new CookieJar("seed"), "/api/admin/seed-teacher", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.adminSecret}` },
      body: {
        email: teacherEmail,
        password,
        displayName: name,
        schoolName: school,
      },
    });
    const teacher = new Teacher(this, {
      email: teacherEmail,
      password,
      displayName: name,
      schoolId: res.json?.schoolId,
      id: res.json?.userId,
    });
    teacher.seedResponse = res;
    return teacher;
  }
}

// ── Handles (value objects) ───────────────────────────────────────────────────

class Classroom {
  constructor({ id, language, response }) {
    this.id = id;
    this.language = language;
    this.response = response;
  }
}

class Quiz {
  constructor({ id, videoId }) {
    this.id = id;
    this.videoId = videoId;
  }
}

class Paper {
  constructor({ quiz, response }) {
    this.quiz = quiz; // the answer-free quiz payload as served to the student
    this.response = response;
  }
  get questions() {
    return this.quiz?.questions ?? [];
  }
}

// ── Teacher actor ─────────────────────────────────────────────────────────────

class Teacher {
  constructor(app, { email, password, displayName, schoolId, id }) {
    this.app = app;
    this.email = email;
    this.password = password;
    this.displayName = displayName;
    this.schoolId = schoolId;
    this.id = id; // userId
    this.jar = new CookieJar("teacher");
  }

  /** Sign in; captures the teacher's session cookies. Returns the raw response. */
  async signIn() {
    const res = await this.app.req(this.jar, "/api/auth/sign-in", {
      method: "POST",
      body: { email: this.email, password: this.password },
    });
    this.role = res.json?.role;
    return res;
  }

  /** Create a class. Returns a Classroom handle (raw response on `.response`). */
  async createClass({ name, language }) {
    const res = await this.app.req(this.jar, "/api/classes", {
      method: "POST",
      body: { name: name ?? `Smoke Class ${this.app.ts}`, language },
    });
    return new Classroom({
      id: res.json?.class?.id,
      language: res.json?.class?.language,
      response: res,
    });
  }

  /** Create a quiz on a video (POST /api/quizzes). Throws on non-201. */
  async createQuizOnVideo(youtubeId, title) {
    const res = await this.app.req(this.jar, "/api/quizzes", {
      method: "POST",
      body: { youtubeId, baseLanguage: "he", title },
    });
    if (res.status !== 201 || !res.json?.quiz?.quiz_id) {
      throw new Error(`POST /api/quizzes failed: ${res.status} ${res.text.slice(0, 200)}`);
    }
    return new Quiz({ id: res.json.quiz.quiz_id, videoId: youtubeId });
  }

  /**
   * Try to AI-generate questions over the quiz's real transcript. Returns
   * `{ ok, status, count, questions, errorCode, text }`; `ok` is true only when
   * the route generated at least one question.
   */
  async generateQuestions(quiz, { count }) {
    const res = await this.app.req(this.jar, `/api/quizzes/${quiz.id}/generate`, {
      method: "POST",
      body: { count },
    });
    const questions = res.json?.questions ?? [];
    return {
      ok: res.status === 201 && questions.length > 0,
      status: res.status,
      count: questions.length,
      questions,
      errorCode: res.json?.error?.code,
      text: res.text,
    };
  }

  /** Author questions manually (POST /api/quizzes/[id]/questions). Throws on failure. */
  async authorQuestions(quiz, fixtures) {
    for (const q of fixtures) {
      const res = await this.app.req(this.jar, `/api/quizzes/${quiz.id}/questions`, {
        method: "POST",
        body: q,
      });
      if (res.status !== 201 || !res.json?.questionId) {
        throw new Error(
          `POST /api/quizzes/${quiz.id}/questions (${q.kind}) failed: ${res.status} ${res.text.slice(0, 200)}`
        );
      }
    }
    return fixtures.length;
  }

  /** Assign a quiz to a class. Returns the raw envelope (`.json.assignment`). */
  assign(quiz, { to, tutor, maxAttempts }) {
    return this.app.req(this.jar, `/api/classes/${to.id}/quizzes`, {
      method: "POST",
      body: { quizId: quiz.id, tutorMode: tutor, maxAttempts },
    });
  }

  /**
   * Invite a student by email (POST /api/classes/[id]/students). Returns a
   * Student actor; the raw invite response is on `.inviteResponse`.
   */
  async inviteStudent(classroom, email) {
    const res = await this.app.req(this.jar, `/api/classes/${classroom.id}/students`, {
      method: "POST",
      body: { email },
    });
    const student = new Student(this.app, { email, password: this.password });
    student.inviteResponse = res;
    return student;
  }

  /** GET /api/analytics/quiz/[quizId]. */
  quizAnalytics(quiz) {
    return this.app.req(this.jar, `/api/analytics/quiz/${quiz.id}`);
  }

  /** GET /api/analytics/class/[classId]. */
  classAnalytics(classroom) {
    return this.app.req(this.jar, `/api/analytics/class/${classroom.id}`);
  }

  /**
   * GET /api/analytics/tutor for exactly one scope (`{ quiz }` or `{ classroom }`),
   * or both to exercise the one-of guard (→ 400).
   */
  tutorAnalytics({ quiz, classroom }) {
    const params = new URLSearchParams();
    if (quiz) params.set("quizId", quiz.id);
    if (classroom) params.set("classId", classroom.id);
    return this.app.req(this.jar, `/api/analytics/tutor?${params.toString()}`);
  }
}

// ── Student actor ─────────────────────────────────────────────────────────────

class Student {
  constructor(app, { email, password }) {
    this.app = app;
    this.email = email;
    this.password = password;
    this.jar = new CookieJar("student");
    this.id = null; // userId, set on signUp
  }

  /** Sign up as a student (POST /api/auth/sign-up-student) — converts any invite. */
  async signUp({ displayName = "Smoke Student" } = {}) {
    const res = await this.app.req(new CookieJar("signup"), "/api/auth/sign-up-student", {
      method: "POST",
      body: { email: this.email, password: this.password, displayName },
    });
    this.id = res.json?.userId;
    return res;
  }

  /** Sign in; captures the student's session cookies. */
  async signIn() {
    const res = await this.app.req(this.jar, "/api/auth/sign-in", {
      method: "POST",
      body: { email: this.email, password: this.password },
    });
    this.role = res.json?.role;
    return res;
  }

  /** Read the quiz as a student (GET /api/attempts/quiz) — must be answer-free. */
  async openQuiz(quiz, classroom) {
    const res = await this.app.req(
      this.jar,
      `/api/attempts/quiz?classId=${classroom.id}&quizId=${quiz.id}`
    );
    return new Paper({ quiz: res.json?.quiz, response: res });
  }

  /** Start an attempt (POST /api/attempts). Returns an Attempt handle. */
  async startAttempt(quiz, classroom) {
    const res = await this.app.req(this.jar, "/api/attempts", {
      method: "POST",
      body: { classId: classroom.id, quizId: quiz.id },
    });
    return new Attempt(this, {
      id: res.json?.attempt?.attempt_id,
      quiz,
      response: res,
    });
  }

  /** Ask the tutor (POST /api/ask). Returns `{ status, text }` (streamed body). */
  askTutor({ quiz, classroom, positionSeconds, prompt }) {
    return this.app.req(this.jar, "/api/ask", {
      method: "POST",
      body: { classId: classroom.id, quizId: quiz.id, positionSeconds, prompt },
    });
  }
}

// ── Attempt handle ────────────────────────────────────────────────────────────

class Attempt {
  constructor(student, { id, quiz, response }) {
    this.student = student;
    this.app = student.app;
    this.id = id;
    this.quiz = quiz;
    this.response = response;
  }

  /** Submit one answer (POST /api/attempts/[id]/answers). Returns raw envelope. */
  answer(questionId, optionIds) {
    return this.app.req(this.student.jar, `/api/attempts/${this.id}/answers`, {
      method: "POST",
      body: { questionId, optionIds },
    });
  }

  /**
   * Submit the correct answer for every live question, reading the key OUT-OF-BAND
   * via the Verifier. Returns the answer key `Map<questionId, optionIds[]>` used.
   */
  async answerAllCorrectly() {
    const questions = await this.app.verify.liveQuestions(this.quiz.id);
    const key = await this.app.verify.answerKeyFor(questions.map((q) => q.id));
    for (const q of questions) {
      await this.answer(q.id, key.get(q.id) || []);
    }
    return key;
  }

  /** Complete the attempt (POST /api/attempts/[id]/complete). Returns raw envelope. */
  complete() {
    return this.app.req(this.student.jar, `/api/attempts/${this.id}/complete`, {
      method: "POST",
    });
  }

  /** Read the reveal-gated review (GET /api/attempts/[id]/review). Raw envelope. */
  review() {
    return this.app.req(this.student.jar, `/api/attempts/${this.id}/review`);
  }
}

/** Build an App bound to a base URL + admin/service credentials. */
export function testApp({ baseUrl, adminSecret, supabaseUrl, serviceKey }) {
  return new App({ baseUrl, adminSecret, supabaseUrl, serviceKey });
}

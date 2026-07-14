/**
 * OrtTube v2 — END-TO-END SMOKE TEST (standalone, NOT vitest).
 *
 * Drives the REAL HTTP API of a running `next dev` server, making REAL
 * YouTube-transcript scrapes and REAL Claude calls (no mocks). Verifies the full
 * teacher→student vertical slice: seed → sign-in → class → quiz (AI or manual) →
 * assign → invite → student signup/sign-in → answer-free read → attempt →
 * grading → reveal gate → tutor → analytics.
 *
 * The plumbing lives in `test/e2e/lib/`: an actor-based DSL (`app.mjs`) over the
 * real HTTP surface with per-actor cookie jars, the fetch/cookie/parsing
 * machinery (`http.mjs`), an out-of-band service-role Verifier (`verify.mjs`),
 * and question-fixture builders (`questions.mjs`). Each STEP below reads as a few
 * DSL lines; every assertion still lives here, unchanged.
 *
 * ── HOW TO RUN ───────────────────────────────────────────────────────────────
 *   1. Local Supabase must be running:      supabase start   (and: supabase db reset)
 *   2. Start the app:                        npm run dev       (must serve :3000)
 *   3. In another shell:                     npm run smoke
 *
 *   Override the target with SMOKE_BASE_URL (default http://localhost:3000).
 *
 * ── AUTH MODEL ───────────────────────────────────────────────────────────────
 *   • Each actor (teacher / student) has its OWN cookie jar over global fetch:
 *     the sign-in route sets session cookies; authenticated requests resend them.
 *   • The Verifier (@supabase/supabase-js with the SERVICE_ROLE key) is used ONLY
 *     out-of-band (reading the answer key to drive a perfect score; confirming the
 *     invite conversion and that a tutor_questions row was logged). Never as the
 *     app's auth, and never to stand in for a missing HTTP route.
 *   • The full teacher→student slice runs entirely over the real Next.js HTTP
 *     surface — quiz authoring, the reveal-gated review, and analytics all have
 *     route handlers. No SECURITY DEFINER RPC is invoked directly to drive it.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import WebSocket from "ws";
// supabase-js constructs a RealtimeClient which needs a WebSocket. Node 20 has no
// native global WebSocket, so provide one (we never actually open a socket here).
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

import { loadEnv } from "./lib/http.mjs";
import { testApp } from "./lib/app.mjs";
import { singleChoice, multiChoice } from "./lib/questions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

// ── env ──────────────────────────────────────────────────────────────────────
loadEnv(join(REPO_ROOT, ".env.local"));

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

for (const [k, v] of Object.entries({
  SUPABASE_URL,
  ANON_KEY,
  SERVICE_KEY,
  ADMIN_SECRET,
})) {
  if (!v) {
    console.error(`FATAL: missing env ${k} (check .env.local)`);
    process.exit(2);
  }
}

// ── pretty logging + assertions ──────────────────────────────────────────────
const gaps = []; // real backend / HTTP-surface gaps discovered
let stepNo = 0;
function step(title) {
  stepNo += 1;
  console.log(`\n── STEP ${stepNo}: ${title}`);
}
function log(msg) {
  console.log(`   ${msg}`);
}
function noteGap(msg) {
  gaps.push(msg);
  console.log(`   [GAP] ${msg}`);
}
class SmokeError extends Error {}
function assert(cond, msg) {
  if (!cond) throw new SmokeError(msg);
  console.log(`   ✓ ${msg}`);
}

// ── the app under test (actor DSL over the real HTTP surface) ────────────────
const app = testApp({
  baseUrl: BASE_URL,
  adminSecret: ADMIN_SECRET,
  supabaseUrl: SUPABASE_URL,
  serviceKey: SERVICE_KEY,
});

// ── candidate videos likely to carry captions (first that resolves wins) ─────
const VIDEO_CANDIDATES = [
  "dQw4w9d9Wgs", // Rick Astley — has captions
  "arj7oStGLkU", // TED-Ed style
  "kJQP7kiw5Fk", // Despacito
  "9bZkp7q19f0", // Gangnam Style
  "aqz-KE-bpKQ", // Big Buck Bunny
  "jNQXAC9IVRw", // Me at the zoo
];

// ── main ─────────────────────────────────────────────────────────────────────
const summary = {
  videoId: null,
  aiPath: false,
  questionCount: 0,
  score: null,
  reveal: null,
  tutorChars: 0,
};

async function main() {
  const studentEmail = app.uniqueEmail("student");

  // Preflight: the dev server must respond.
  step("Preflight — dev server reachable");
  assert(await app.serverReachable(), `dev server responded at ${BASE_URL}`);

  // 1. Seed school + teacher.
  step("Seed school + teacher (POST /api/admin/seed-teacher)");
  const teacher = await app.seedTeacher({ school: `Smoke School ${app.ts}` });
  const seed = teacher.seedResponse;
  assert(seed.status === 201, `seed-teacher → 201 (got ${seed.status} ${seed.text.slice(0, 200)})`);
  assert(!!teacher.schoolId && !!teacher.id, `returned schoolId + userId`);

  // 2. Teacher sign-in.
  step("Teacher sign-in (POST /api/auth/sign-in) — captures teacher cookies");
  const tin = await teacher.signIn();
  assert(tin.status === 200, `sign-in → 200 (got ${tin.status} ${tin.text.slice(0, 200)})`);
  assert(tin.json.role === "teacher", `role === 'teacher'`);
  assert(teacher.jar.hasSession, `teacher session cookie captured`);

  // 3. Teacher creates a class (language 'he').
  step("Teacher creates a class (POST /api/classes, language 'he')");
  const biology = await teacher.createClass({ name: `Smoke Class ${app.ts}`, language: "he" });
  assert(biology.response.status === 201, `create class → 201 (got ${biology.response.status} ${biology.response.text.slice(0, 200)})`);
  assert(biology.language === "he", `class language === 'he'`);
  const classId = biology.id;

  // 4. Teacher creates a quiz on a REAL video + AI-generate (fallback: manual).
  step("Teacher creates a quiz + questions (AI generate over real transcript, else manual)");

  let quiz = null;
  let usedVideoId = null;
  // Try each candidate: create a quiz on it, then hit the REAL AI generate
  // endpoint. First transcript that resolves wins.
  for (const videoId of VIDEO_CANDIDATES) {
    const candidate = await teacher.createQuizOnVideo(videoId, `Smoke Quiz ${videoId}`);
    log(`created quiz ${candidate.id} on video ${videoId}; POST /api/quizzes/${candidate.id}/generate`);
    const generated = await teacher.generateQuestions(candidate, { count: 3 });
    if (generated.ok) {
      quiz = candidate;
      usedVideoId = videoId;
      summary.aiPath = true;
      summary.questionCount = generated.count;
      log(`AI generation succeeded: ${generated.count} questions from real transcript`);
      break;
    }
    log(`generate on ${videoId} → ${generated.status} ${generated.errorCode || generated.text.slice(0, 120)} (trying next candidate)`);
    // OOB housekeeping: soft-delete the unusable quiz so leftovers don't pollute
    // the teacher's library.
    await app.verify.discardQuiz(candidate.id);
  }

  if (!quiz) {
    // FALLBACK: transcript outage / YouTube flaky. Author manually so the rest of
    // the slice still runs. NOT a failure — but reported.
    noteGap(
      "AI path SKIPPED: no candidate video transcript resolved (YouTube/transcript " +
        "outage). Fell back to manual authoring. This is a transcript availability " +
        "issue, not necessarily a backend bug."
    );
    quiz = await teacher.createQuizOnVideo(VIDEO_CANDIDATES[0], `Smoke Quiz manual ${app.ts}`);
    usedVideoId = VIDEO_CANDIDATES[0];
    log(`manual authoring: POST /api/quizzes/${quiz.id}/questions (single + multi)`);
    await teacher.authorQuestions(quiz, [
      singleChoice({
        prompt: "מה שתיים ועוד שתיים (2+2)?", // "how much is 2+2"
        at: 30,
        order: 0,
        explanation: "2+2=4.",
        correct: "4",
        distractors: ["3", "5", "22"],
      }),
      multiChoice({
        prompt: "איזה מהנים זוגיים?", // "which numbers are even"
        at: 60,
        order: 1,
        explanation: "2 and 4 are even.",
        correct: ["2", "4"],
        distractors: ["3", "5"],
      }),
    ]);
    summary.aiPath = false;
    summary.questionCount = 2;
    log(`manual authoring created 2 questions`);
  }
  summary.videoId = usedVideoId;

  // Validate the answer key OOB: >=1 correct per question, exactly one for 'single'.
  await assertAnswerKeySane(quiz);

  // 5. Teacher assigns the quiz to the class (tutor_mode 'hints', max_attempts 1).
  step("Teacher assigns quiz to class (POST /api/classes/[id]/quizzes, hints, max_attempts 1)");
  const assign = await teacher.assign(quiz, { to: biology, tutor: "hints", maxAttempts: 1 });
  assert(assign.status === 201, `assign → 201 (got ${assign.status} ${assign.text.slice(0, 200)})`);
  assert(assign.json.assignment.tutor_mode === "hints", `tutor_mode === 'hints'`);
  assert(assign.json.assignment.max_attempts === 1, `max_attempts === 1`);

  // 6. Teacher invites student by email → pending invite; then student signs up.
  step("Teacher adds student by email (POST /api/classes/[id]/students) → pending invite");
  const student = await teacher.inviteStudent(biology, studentEmail);
  const add = student.inviteResponse;
  assert(add.status === 201, `add unknown student → 201 invited (got ${add.status} ${add.text.slice(0, 200)})`);
  assert(add.json.status === "invited", `status === 'invited'`);
  assert(
    (await app.verify.pendingInviteCount(classId, studentEmail)) === 1,
    `OOB: exactly one pending class_invite exists`
  );

  step("Student signs up (POST /api/auth/sign-up-student) → invite converts to membership");
  const su = await student.signUp({ displayName: "Smoke Student" });
  assert(su.status === 201, `sign-up-student → 201 (got ${su.status} ${su.text.slice(0, 200)})`);
  const studentId = student.id;
  assert(
    (await app.verify.membershipCount(classId, studentId)) === 1,
    `OOB: invite converted → class_members row exists`
  );
  assert(
    (await app.verify.pendingInviteCount(classId, studentEmail)) === 0,
    `OOB: consumed invite was deleted`
  );

  step("Student sign-in (POST /api/auth/sign-in) — captures student cookies");
  const sin = await student.signIn();
  assert(sin.status === 200, `student sign-in → 200 (got ${sin.status} ${sin.text.slice(0, 200)})`);
  assert(sin.json.role === "student", `role === 'student'`);

  // 7. Student reads the quiz (answer-free). NO is_correct, NO explanation.
  step("Student reads quiz (GET /api/attempts/quiz) — must be answer-free");
  const paper = await student.openQuiz(quiz, biology);
  assert(paper.response.status === 200, `student read → 200 (got ${paper.response.status} ${paper.response.text.slice(0, 200)})`);
  const studentQuiz = paper.quiz;
  assert(Array.isArray(studentQuiz.questions) && studentQuiz.questions.length > 0, `quiz has questions`);
  {
    const blob = JSON.stringify(studentQuiz);
    assert(!/"is_correct"/.test(blob), `payload contains NO is_correct`);
    assert(!/"explanation"/.test(blob), `payload contains NO explanation`);
    for (const q of studentQuiz.questions) {
      for (const o of q.options) {
        if ("is_correct" in o) throw new SmokeError(`option leaked is_correct on question ${q.id}`);
      }
    }
    log(`verified ${studentQuiz.questions.length} questions carry only {id,order_index,text} options`);
  }

  // 8. Student attempt: start, submit CORRECT answers (answer key read OOB), complete.
  step("Student starts attempt (POST /api/attempts)");
  const attempt = await student.startAttempt(quiz, biology);
  assert(attempt.response.status === 201, `start attempt → 201 (got ${attempt.response.status} ${attempt.response.text.slice(0, 200)})`);
  assert(!!attempt.id, `got attempt_id`);

  step("Submit CORRECT answers (answer key read OUT-OF-BAND) + complete");
  const correctByQuestion = await app.verify.answerKeyFor(studentQuiz.questions.map((q) => q.id));
  for (const q of studentQuiz.questions) {
    const optionIds = correctByQuestion.get(q.id) || [];
    assert(optionIds.length >= 1, `OOB answer key present for question ${q.id.slice(0, 8)}`);
    const ans = await attempt.answer(q.id, optionIds);
    if (ans.status !== 200) {
      throw new SmokeError(`submit answer failed for ${q.id}: ${ans.status} ${ans.text.slice(0, 200)}`);
    }
  }
  const complete = await attempt.complete();
  assert(complete.status === 200, `complete → 200 (got ${complete.status} ${complete.text.slice(0, 200)})`);
  const s = complete.json.summary;
  summary.score = `${s.num_correct}/${s.num_questions}`;
  assert(
    s.num_correct === s.num_questions && s.num_questions === studentQuiz.questions.length,
    `grading: num_correct (${s.num_correct}) === num_questions (${s.num_questions}) — perfect score`
  );

  // 9. Reveal gate. max_attempts=1 + completed = exhausted → full per-question reveal.
  step("Reveal gate (GET /api/attempts/[attemptId]/review) — exhausted attempt reveals per-question detail");
  const rev = await attempt.review();
  assert(rev.status === 200, `review → 200 (got ${rev.status} ${rev.text.slice(0, 200)})`);
  const review = rev.json.review;
  assert(review.revealed === true, `revealed === true (max_attempts=1, exhausted)`);
  assert(review.completed === true, `completed === true`);
  assert(Array.isArray(review.questions) && review.questions.length === studentQuiz.questions.length, `per-question review present`);
  {
    let allCorrect = true;
    let allHaveKey = true;
    let anyExplanation = false;
    for (const rq of review.questions) {
      if (rq.was_correct !== true) allCorrect = false;
      if (!Array.isArray(rq.correct_option_ids) || rq.correct_option_ids.length === 0) allHaveKey = false;
      if (rq.explanation != null && String(rq.explanation).length > 0) anyExplanation = true;
    }
    assert(allCorrect, `every reviewed question was_correct === true`);
    assert(allHaveKey, `every reviewed question exposes correct_option_ids`);
    assert(anyExplanation, `explanations are revealed post-reveal`);
  }
  summary.reveal = "revealed(full)";

  // 9b. Second quiz with max_attempts=2 → SCORE-ONLY while a retake remains.
  step("Reveal gate (retake remains) — second quiz max_attempts=2, complete attempt 1 → score-only");
  const quiz2 = await createManualQuiz2(teacher);
  const assign2 = await teacher.assign(quiz2, { to: biology, tutor: "hints", maxAttempts: 2 });
  assert(assign2.status === 201, `assign quiz2 → 201 (got ${assign2.status} ${assign2.text.slice(0, 160)})`);
  // Student reads quiz2 (frozen after start) + does one attempt.
  await student.openQuiz(quiz2, biology);
  const attempt2 = await student.startAttempt(quiz2, biology);
  await attempt2.answerAllCorrectly(); // answer key read out-of-band by the Verifier
  await attempt2.complete();
  const rev2 = await attempt2.review();
  assert(rev2.status === 200, `quiz2 review → 200 (got ${rev2.status} ${rev2.text.slice(0, 160)})`);
  const review2 = rev2.json.review;
  assert(review2.completed === true, `quiz2 attempt completed`);
  assert(review2.revealed === false, `quiz2 review is SCORE-ONLY (revealed === false) while retake remains`);
  assert(review2.questions === undefined, `quiz2 review carries NO per-question answer key`);
  assert(typeof review2.num_correct === "number" && typeof review2.num_questions === "number", `quiz2 review still exposes aggregate score`);

  // 10. Tutor — stream a real Claude answer, then confirm the log row OOB.
  step("Tutor (POST /api/ask) — stream a real Claude answer for quiz1");
  const ask = await student.askTutor({
    quiz,
    classroom: biology,
    positionSeconds: 30,
    prompt: "Can you give me a hint about the main idea so far?",
  });
  assert(ask.status === 200, `ask → 200 (got ${ask.status})`);
  const tutorText = ask.text;
  summary.tutorChars = tutorText.length;
  assert(tutorText.trim().length > 0, `tutor streamed non-empty text (${tutorText.length} chars)`);
  {
    // Logging is best-effort/post-stream; poll briefly for the row.
    const found = await app.verify.waitForTutorQuestion(studentId, quiz.id);
    assert(found >= 1, `OOB: a tutor_questions row was logged for this student/quiz`);
  }

  // 11. Teacher analytics — the completed attempt is reflected.
  step("Teacher analytics (GET /api/analytics/quiz + /class) — completed attempt reflected");
  const qStats = await teacher.quizAnalytics(quiz);
  assert(qStats.status === 200, `quiz analytics → 200 (got ${qStats.status} ${qStats.text.slice(0, 200)})`);
  const qs = qStats.json.stats;
  assert(qs.completion_count >= 1, `quiz_stats.completion_count >= 1 (got ${qs.completion_count})`);
  assert(qs.average_score === 1 || qs.average_score === "1" || Number(qs.average_score) === 1, `quiz_stats.average_score === 1 (perfect) (got ${qs.average_score})`);
  assert(Array.isArray(qStats.json.questions?.questions), `quiz analytics also carries per-question stats`);
  const cStats = await teacher.classAnalytics(biology);
  assert(cStats.status === 200, `class analytics → 200 (got ${cStats.status} ${cStats.text.slice(0, 200)})`);
  const cs = cStats.json.stats;
  const quiz1Stat = (cs.quizzes || []).find((z) => z.quiz_id === quiz.id);
  assert(!!quiz1Stat, `class_stats lists quiz1`);
  assert(quiz1Stat.completion_count >= 1, `class_stats quiz1 completion_count >= 1 (got ${quiz1Stat.completion_count})`);
  assert(cs.current_member_count >= 1, `class_stats.current_member_count >= 1`);

  // 11b. Tutor analytics — the tutor interaction is reflected (one-of scope rule).
  step("Teacher tutor analytics (GET /api/analytics/tutor?quizId=...) — interaction reflected");
  const tStats = await teacher.tutorAnalytics({ quiz });
  assert(tStats.status === 200, `tutor analytics → 200 (got ${tStats.status} ${tStats.text.slice(0, 200)})`);
  assert(tStats.json.stats.scope === "quiz", `tutor_stats scope === 'quiz'`);
  assert(tStats.json.stats.total_questions >= 1, `tutor_stats.total_questions >= 1 (got ${tStats.json.stats.total_questions})`);
  const tBad = await teacher.tutorAnalytics({ quiz, classroom: biology });
  assert(tBad.status === 400, `tutor analytics rejects both scopes → 400 (got ${tBad.status})`);

  // ── done ──
  console.log("\n" + "=".repeat(72));
  console.log("SMOKE PASSED");
  console.log("=".repeat(72));
  console.log(`  video id .......... ${summary.videoId}`);
  console.log(`  quiz path ......... ${summary.aiPath ? "REAL AI (transcript + Claude)" : "MANUAL fallback (no transcript)"}`);
  console.log(`  question count .... ${summary.questionCount}`);
  console.log(`  score ............. ${summary.score} (perfect)`);
  console.log(`  reveal (q1) ....... ${summary.reveal}`);
  console.log(`  reveal (q2) ....... score-only (retake remains)`);
  console.log(`  tutor chars ....... ${summary.tutorChars}`);
  const uniqueGaps = [...new Set(gaps)];
  if (uniqueGaps.length) {
    console.log("\n  Notes (non-fatal — e.g. transcript availability fallback):");
    for (const g of uniqueGaps) console.log(`    - ${g}`);
  } else {
    console.log("\n  No gaps: the full slice ran over the real HTTP surface.");
  }
  console.log("");
}

// ── local helpers (assertions + fixtures that stay with the narrative) ────────

/** A separate manual quiz with a single one-correct-option question (for the
 *  score-only reveal branch). */
async function createManualQuiz2(teacher) {
  const videoId = VIDEO_CANDIDATES[VIDEO_CANDIDATES.length - 1];
  const quiz2 = await teacher.createQuizOnVideo(videoId, `Smoke Quiz 2 ${app.ts}`);
  log(`POST /api/quizzes/${quiz2.id}/questions (single) on quiz2`);
  await teacher.authorQuestions(quiz2, [
    singleChoice({ prompt: "1+1=?", at: 15, order: 0, explanation: "1+1=2.", correct: "2", distractors: ["3"] }),
  ]);
  return quiz2;
}

/** Validate the answer key is sane: >=1 correct per question, exactly one for single. */
async function assertAnswerKeySane(quiz) {
  const questions = await app.verify.liveQuestions(quiz.id);
  assert(questions.length >= 1, `OOB: quiz has >=1 live question`);
  const key = await app.verify.answerKeyFor(questions.map((q) => q.id));
  for (const q of questions) {
    const correct = key.get(q.id) || [];
    if (q.kind === "single") {
      if (correct.length !== 1) {
        throw new SmokeError(`single question ${q.id} must have exactly 1 correct (has ${correct.length})`);
      }
    } else if (correct.length < 1) {
      throw new SmokeError(`multi question ${q.id} must have >=1 correct (has ${correct.length})`);
    }
  }
  assert(true, `OOB: answer key valid (>=1 correct/question; exactly one for single)`);
}

// ── run ──────────────────────────────────────────────────────────────────────
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n" + "=".repeat(72));
    console.error(`SMOKE FAILED at step ${stepNo}`);
    console.error("=".repeat(72));
    console.error(e instanceof SmokeError ? `  ${e.message}` : e);
    if (gaps.length) {
      console.error("\n  Gaps recorded before failure:");
      for (const g of [...new Set(gaps)]) console.error(`    - ${g}`);
    }
    process.exit(1);
  });

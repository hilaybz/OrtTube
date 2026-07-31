/*
 * Seed a full, PLAYABLE assignment so the P1 student loop is testable before the
 * teacher authoring/classes UIs (P2/P3) exist.
 *
 * Requires: `supabase start` (local stack) + `npm run dev` running, and
 * `.env.local` populated (ADMIN_SECRET, NEXT_PUBLIC_SUPABASE_*). Run via:
 *     npm run seed
 * which loads .env.local through `node --env-file`.
 *
 * Drives the documented HTTP API exactly as a real client would (admin secret for
 * provisioning, then the teacher's session cookie for authoring/assignment).
 * Prints the resulting (classId, quizId) and the student login at the end.
 */

const BASE = process.env.SEED_BASE_URL ?? "http://localhost:3000";
const ADMIN_SECRET = process.env.ADMIN_SECRET;
if (!ADMIN_SECRET) {
  console.error("ADMIN_SECRET missing — run via `npm run seed` (loads .env.local).");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const teacher = { email: `teacher.${stamp}@ort.test`, password: "teacher-pass-123", displayName: "מורה בדיקה" };
const student = { email: `student.${stamp}@ort.test`, password: "student-pass-123", displayName: "תלמיד בדיקה" };
// A short video that has captions available.
const YOUTUBE_URL = process.env.SEED_YOUTUBE_URL ?? "https://www.youtube.com/watch?v=aircAruvnKk";

let cookies = "";
function captureCookies(res) {
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) {
    const jar = new Map(cookies ? cookies.split("; ").map((c) => [c.split("=")[0], c]) : []);
    for (const c of set) {
      const pair = c.split(";")[0];
      jar.set(pair.split("=")[0], pair);
    }
    cookies = [...jar.values()].join("; ");
  }
}

async function call(path, { method = "POST", body, admin = false } = {}) {
  const headers = { "content-type": "application/json" };
  if (admin) headers.authorization = `Bearer ${ADMIN_SECRET}`;
  if (cookies) headers.cookie = cookies;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  captureCookies(res);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  console.log("• provisioning teacher…");
  await call("/api/admin/seed-teacher", {
    admin: true,
    body: { ...teacher, schoolName: "בית ספר בדיקה" },
  });

  console.log("• signing in as teacher…");
  await call("/api/auth/sign-in", { body: { email: teacher.email, password: teacher.password } });

  console.log("• creating quiz on video…");
  const created = await call("/api/quizzes", {
    body: { youtubeUrl: YOUTUBE_URL, baseLanguage: "he", title: "חידון בדיקה" },
  });
  const quizId = created.quiz.quiz_id;

  console.log("• authoring questions…");
  await call(`/api/quizzes/${quizId}/questions`, {
    body: {
      kind: "single",
      positionSeconds: 30,
      orderIndex: 0,
      basePrompt: "מהו הנושא המרכזי של הקטע הראשון?",
      baseExplanation: "הקטע הראשון מציג את רשתות הנוירונים.",
      options: [
        { is_correct: true, order_index: 0, base_text: "רשתות נוירונים" },
        { is_correct: false, order_index: 1, base_text: "בסיסי נתונים" },
        { is_correct: false, order_index: 2, base_text: "גרפיקה ממוחשבת" },
      ],
    },
  });
  await call(`/api/quizzes/${quizId}/questions`, {
    body: {
      kind: "multi",
      positionSeconds: 90,
      orderIndex: 1,
      basePrompt: "אילו רכיבים הוזכרו? (בחר/י כל מה שמתאים)",
      baseExplanation: "הוזכרו נוירונים ומשקלים.",
      options: [
        { is_correct: true, order_index: 0, base_text: "נוירון" },
        { is_correct: true, order_index: 1, base_text: "משקל" },
        { is_correct: false, order_index: 2, base_text: "מדפסת" },
      ],
    },
  });

  console.log("• creating class…");
  const klass = await call("/api/classes", { body: { name: "כיתה ז׳-3", language: "he" } });
  const classId = klass.class.id;

  console.log("• inviting student (pending invite)…");
  await call(`/api/classes/${classId}/students`, { body: { email: student.email } });

  console.log("• student signs up (invite → membership)…");
  const savedCookies = cookies;
  cookies = ""; // sign up as a fresh session, not the teacher's
  await call("/api/auth/sign-up-student", { body: student });
  cookies = savedCookies; // restore teacher session for the assignment

  console.log("• assigning quiz to class…");
  await call(`/api/classes/${classId}/quizzes`, {
    body: { quizId, tutorMode: "hints", maxAttempts: 2 },
  });

  console.log("\n✅ Seed complete. Playable assignment:");
  console.log(JSON.stringify({ classId, quizId, student: { email: student.email, password: student.password } }, null, 2));
  console.log(`\nStudent play URL: ${BASE}/student/quiz/${classId}/${quizId}`);
}

main().catch((e) => {
  console.error("\n❌ Seed failed:", e.message);
  process.exit(1);
});

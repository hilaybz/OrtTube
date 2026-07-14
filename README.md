# OrtTube

OrtTube is an educational platform that turns a YouTube video into an interactive,
multilingual quiz that teachers assign to their classes. A teacher authors (or
AI-generates) questions anchored to points in a video; students watch, answer at
each checkpoint, and can ask an AI tutor follow-up questions grounded in the part
of the video they've watched so far. Teachers see per-quiz and per-class
analytics.

## How it works

- **Schools, teachers, students, classes.** Every user belongs to a school.
  Teachers own classes and quizzes; students are enrolled in classes (by email,
  with pending invites that convert on signup). All access is tenant-isolated by
  school.
- **Videos are canonical and shared.** A YouTube video is stored once and reused
  across quizzes and schools; its transcript is fetched once and cached.
- **Quizzes are multilingual with a structural answer key.** Questions are
  authored in a base language; correctness lives in the options (`is_correct`),
  independent of language. Other languages are filled in by AI translation, and
  each student reads the quiz in their resolved language
  (`preferred → class → base`).
- **Assignment controls delivery.** Assigning a quiz to a class sets the tutor
  mode (`off`/`hints`/`full`) and the attempt cap.
- **Results respect a reveal gate.** A student sees per-question correctness and
  explanations only once no retake remains; while attempts are left, they see the
  score only.

## Architecture

```
Browser ──HTTP──▶ Next.js route handler (app/api/**)
                      │  authenticate + validate
                      ▼
                  @/lib/* wrapper
                      │  supabase-js .rpc()
                      ▼
                  SECURITY DEFINER Postgres RPC  ──▶  tables (+ RLS, triggers)
```

The route handlers are thin. The real logic — ownership checks, tenant isolation,
grading, the reveal gate, correctness constraints — lives in Postgres
(`SECURITY DEFINER` functions + Row-Level Security), so it holds no matter which
caller reaches it. AI (Claude) powers quiz generation, translation, and the
streaming tutor. Transcripts are cached in Supabase Storage.

- **Stack:** Next.js (App Router, TypeScript), Supabase (Postgres + Auth +
  Storage), Anthropic Claude.
- **Docs:** [`docs/data-model.md`](docs/data-model.md) (schema + ER diagram),
  [`docs/api.md`](docs/api.md) (endpoints + RPC layer).

## Getting started

Prerequisites: Node, the [Supabase CLI](https://supabase.com/docs/guides/cli),
and Docker (for the local Supabase stack).

```bash
# 1. Install deps
npm install

# 2. Start the local Supabase stack (Postgres + Auth + Storage)
supabase start

# 3. Configure environment
cp .env.local.example .env.local
#    Fill in ANTHROPIC_API_KEY and the Supabase URL/keys printed by `supabase start`.

# 4. Generate typed DB bindings from the local schema
npm run gen:types

# 5. Run the app
npm run dev            # http://localhost:3000
```

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server. |
| `npm run build` / `npm start` | Production build / serve. |
| `npm run lint` | ESLint. |
| `npm test` | Run the Vitest suite once. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run smoke` | End-to-end smoke test against a running app (real YouTube + Claude). |
| `npm run gen:types` | Regenerate `lib/supabase/types.ts` from the local schema. |

## Testing

- **Unit tests** mock `@/lib` / route internals — no database.
- **Integration tests** drive the real RPC + RLS layer through an actor DSL
  (`test/helpers/testbed/`). Each test calls `freshTestbed()` in `beforeEach`,
  which resets the local DB and returns an isolated world; actors
  (`school.enrollTeacher(...)`, `teacher.authorQuiz(...)`,
  `student.startAttempt(...)`) call the real service wrappers as authenticated,
  RLS-subject clients. These target the **local** Supabase stack and self-skip
  when it's unreachable, so unit tests still run offline.
- **Smoke test** (`npm run smoke`) exercises the HTTP surface end to end against a
  running dev server, including real transcript fetch, AI generation, and the
  tutor stream.

`lib/supabase/types.ts` is **generated** — after any migration, run
`npm run gen:types` and commit the result alongside the migration.

## Environment

See [`.env.local.example`](.env.local.example) for the full list. Notable:
`ANTHROPIC_API_KEY`, the Supabase URL/keys, `SUPABASE_DB_URL` (used by the test
harness), and two separate bearer secrets — `CRON_SECRET` for scheduled jobs and
`ADMIN_SECRET` for admin endpoints.

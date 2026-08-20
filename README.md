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

Prerequisites: Node and the [Supabase CLI](https://supabase.com/docs/guides/cli).

The project targets a **hosted** Supabase instance — there is no local Docker
stack. The tooling therefore works against the *linked* remote project.

```bash
# 1. Install deps
npm install

# 2. Link the CLI to the hosted project
supabase link --project-ref <your-project-ref>

# 3. Apply the schema (all migrations, in order)
supabase db push

# 4. Configure environment
cp .env.local.example .env.local
#    Fill in ANTHROPIC_API_KEY, the Supabase URL/keys from the project's API
#    settings, and ADMIN_SECRET / CRON_SECRET (any two distinct random strings).

# 5. Generate typed DB bindings from the linked schema
npm run gen:types

# 6. Provision the first teacher — there is no teacher self-signup
npm run dev            # http://localhost:3000
npm run seed           # seeds a teacher, student, class and playable quiz
```

Leave `SUPABASE_DB_URL` unset. The test harness truncates every table and clears
`auth.users` on each `beforeEach`, so pointing it at the hosted project would wipe
it; only ever set it to a local throwaway Postgres.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server. |
| `npm run build` / `npm start` | Production build / serve. |
| `npm run lint` | ESLint. |
| `npm test` | Run the Vitest suite once. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run smoke` | End-to-end smoke test against a running app (real YouTube + Claude). |
| `npm run seed` | Seed a teacher, student, class and playable quiz via the HTTP API. |
| `npm run gen:types` | Regenerate `lib/supabase/types.ts` from the linked (remote) schema. |

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

## Deploying (Vercel)

Set these seven in the Vercel project's environment variables. Two are worth
calling out because searching the code for their names finds nothing:
`ANTHROPIC_API_KEY` is read implicitly by the Anthropic SDK constructor, and
`CRON_SECRET` is looked up through a map in [`lib/jobs/auth.ts`](lib/jobs/auth.ts).

| Variable | Notes |
| --- | --- |
| `ANTHROPIC_API_KEY` | read implicitly by `new Anthropic()` |
| `NEXT_PUBLIC_SUPABASE_URL` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only; bypasses RLS |
| `TRANSCRIPT_BUCKET` | `transcripts` |
| `CRON_SECRET` | guards `/api/jobs/*`; Vercel Cron sends it automatically |
| `ADMIN_SECRET` | guards `/api/admin/*`; must differ from `CRON_SECRET` |
| `YOUTUBE_PROXY_URLS` | **production only** — see below; leave empty locally |

Optional tuning, all defaulted: `GC_VIDEO_GRACE_MINUTES`, `PURGE_RETENTION_DAYS`,
`RECONCILE_AUTH_MINUTES`, `TRANSCRIPT_TTL_DAYS`.

### YouTube egress

YouTube bot-checks datacenter IPs, and Vercel's functions run on one: without a
proxy, every watch-page and InnerTube request from production returns
`playabilityStatus: LOGIN_REQUIRED`, which breaks transcripts *and* the
`duration_seconds` scrape. (Titles come from oEmbed, a different endpoint, and
are unaffected — which is why a broken video still shows its name.)

`YOUTUBE_PROXY_URLS` is a comma-separated pool, tried in order with the
last-known-good entry preferred, accepting either `http://user:pass@host:port`
or the `host:port:user:pass` form dashboards export. An exit that answers 429 or
a bot check is skipped for the next one. **Empty means no proxy** — the right
setting locally, where a residential IP already works, and the kill switch in
production.

Proxies get burned over time. [`scripts/probe-proxy.mjs`](scripts/probe-proxy.mjs)
(`npm run probe:proxy`) reports which entries still clear the check, and refuses
to draw conclusions from a proxy that was never actually in the request path.
**Changing provider is a change to this variable's value only** — the pool
interface is identical whether it holds ten cheap datacenter proxies or one
residential endpoint.

**Never set `SUPABASE_DB_URL` in a deployed environment.** No application code
reads it — only the test harness, which truncates every table and clears
`auth.users`.

### Scheduled jobs

[`vercel.json`](vercel.json) schedules the four maintenance endpoints (staggered
so they don't overlap): transcript sweep 03:00 UTC daily, orphan-video GC 03:30
daily, auth reconcile 04:00 daily, and the content retention purge 05:00 Sundays.

Vercel Cron invokes paths with **GET**, so each job route exports `GET = POST`
alongside its `POST`; a POST-only handler would return 405 and the job would
silently never run. Vercel attaches `Authorization: Bearer $CRON_SECRET` itself
when that variable is set, which is what the routes already check.

Hobby accounts cap the number of cron jobs and allow only daily granularity — if
the schedule above is rejected, collapse the four into one dispatcher rather than
dropping jobs.

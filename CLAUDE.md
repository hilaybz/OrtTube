# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code
in this repository.

@AGENTS.md

## Project overview

**OrtTube** turns a YouTube video into an interactive, multilingual quiz that
teachers assign to their classes. Teachers author (or AI-generate) questions
anchored to points in a video; students watch, answer at each checkpoint, and can
ask an AI tutor grounded in the portion watched so far. Teachers see per-quiz and
per-class analytics. Entirely TypeScript/Next.js on Supabase (Postgres) — no
Python backend.

See [`README.md`](README.md) for the overview, [`docs/data-model.md`](docs/data-model.md)
for the schema + ER diagram, and [`docs/api.md`](docs/api.md) for the endpoints.

**Current state:** the backend (schema, RPCs, `@/lib/*` service layer, and the
`app/api/**` HTTP handlers) is the substance of the codebase. The browser UI is a
thin shell; build user-facing pages against the documented API, not against any
pre-existing component library.

## Commands

```bash
npm run dev        # Dev server (localhost:3000)
npm run build      # Production build
npm run start      # Serve production build
npm run lint       # ESLint
npm test           # Vitest suite once
npm run test:watch # Vitest watch mode
npm run smoke      # E2E smoke against a running app (real YouTube + Claude)
npm run gen:types  # Regenerate lib/supabase/types.ts from the local schema
```

Local development needs the Supabase CLI stack running (`supabase start`, requires
Docker) with `.env.local` filled from `.env.local.example`.

## Architecture

Requests flow **HTTP route handler → `@/lib/*` wrapper → `SECURITY DEFINER`
Postgres RPC → tables (RLS + triggers)**. Keep handlers thin: authenticate,
validate, delegate. **Business rules live in the database**, not in TypeScript —
ownership, tenant isolation (by school), grading, correctness constraints, and the
reveal gate are enforced by RPCs, RLS policies, and triggers, so they hold
regardless of caller.

- User-facing endpoints run RPCs with the caller's `auth.uid()` via the SSR
  Supabase client, so RLS applies. Admin/job endpoints use a bearer secret
  (`ADMIN_SECRET` / `CRON_SECRET`) and the service-role client instead.
- AI (Anthropic Claude) powers quiz generation, translation, and the streaming
  tutor. Transcripts are fetched once per video and cached in Supabase Storage.
- Errors use the uniform envelope `{ error: { code, message } }`; the HTTP status
  is mapped from the stable code the RPC raised.

## Data model essentials

Full detail in [`docs/data-model.md`](docs/data-model.md). Load-bearing invariants:

- **Answer key is structural and language-independent** — correctness is
  `question_options.is_correct`; translations carry only display text.
- **Language resolution:** `profiles.preferred_language → classes.language →
  quizzes.base_language`.
- **Reveal gate:** per-question correctness/explanations are returned to a student
  only when no retake remains; otherwise the response is score-only. Students have
  no direct read grant on `answers` / `answer_selections`.
- **Immutability:** a profile's `role` and `school_id` never change; teachers are
  deactivated, not deleted.
- **Videos are canonical/shared/ownerless**, deduped by `youtube_video_id`.

## Database & generated types

- Schema and RPCs live in `supabase/migrations/*.sql` (the source of truth).
- `lib/supabase/types.ts` is **generated, not hand-edited**. After any migration,
  run `npm run gen:types` and commit the regenerated file alongside the migration.

## Testing

Vitest. Three layers:

- **Unit** (`*.unit.test.ts`) — mock `@/lib` / route internals; no DB.
- **Integration** (`*.int.test.ts` and the `test/integration/` DDL/RLS tests) —
  drive the real RPC + RLS layer through the **actor DSL** in
  `test/helpers/testbed/`. Each test calls `freshTestbed()` in `beforeEach` (resets
  the local DB, returns an isolated world), then reads as a story:
  `school.enrollTeacher(...)`, `teacher.authorQuiz({ questions: [...] })`,
  `student.startAttempt(...)`, `attempt.complete()`, with `testbed.db` for
  out-of-band assertions. Tests target the **local** Supabase stack and self-skip
  when it's unreachable. The `test/helpers/db.ts` fixture harness backs the
  low-level `schema.test.ts` only.
- **Smoke** (`npm run smoke`) — drives the HTTP surface end to end against a
  running dev server.

When adding a test, prefer the testbed DSL and intention-revealing names; extend
the DSL (in `test/helpers/testbed/`) rather than dropping to raw SQL.

## Conventions

- **Path alias:** `@/*` maps to the repo root — use `@/lib/...`, `@/app/...`.
- **Comments describe the current code and design** — logic/business intent, not
  history, versions, migration numbers, or spec sections.
- **Claude model:** default to the latest appropriate Claude model for AI features.

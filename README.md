# OrtTube

OrtTube turns a YouTube video into an interactive, multilingual quiz that
teachers assign to their classes.

A teacher pastes a video link, writes questions or has AI generate them from the
transcript, and pins each question to a moment in the video. Students watch, and
the video pauses at each checkpoint until they answer. While watching they can ask
an AI tutor that knows only what the video has said so far, and never the answer
key. Teachers then see how each class, quiz, question and student did.

Built for schools: every user belongs to a school, teachers own classes and
quizzes, and quiz content is stored per language (Hebrew, Arabic, English). The
interface itself is Hebrew, right-to-left.

## Features

**Teachers**

- Author questions on a draggable video timeline, or generate them with AI from
  the transcript (count, difficulty, options per question, single or multi).
- Assign a quiz to one or many classes, each with its own tutor mode (off, hints,
  full), attempt limit, publish state and availability window.
- Share quizzes within the school; other teachers preview and clone them.
- Analytics hub by student, class or quiz: scores, per-question breakdowns,
  roster progress, tutor-question log, and an AI summary of what students
  struggled with.

**Students**

- A feed of assigned quizzes with status and due dates.
- A gated player: no seeking past an unanswered checkpoint, deadline countdown.
- An AI tutor beside the video, answering in the student's language.
- Score immediately; per-question review only once no retake remains.

**School**

- Accounts are provisioned by the school; students can be invited by email before
  they sign up. Deleting a student anonymizes their attempts rather than removing
  them. Teachers are deactivated and their content reassigned.

## Architecture

**Stack:** Next.js (App Router, TypeScript) on Vercel, Supabase (Postgres, Auth,
Storage), Anthropic Claude.

```
Browser ──▶ Next.js route handler ──▶ lib/ wrapper ──▶ SECURITY DEFINER RPC ──▶ tables
            authenticate, validate      .rpc() as the        business rules      RLS, grants,
            map error codes             signed-in user                           triggers
```

Route handlers and the `lib/` layer are thin. Ownership, tenant isolation,
grading, attempt limits, availability windows and the reveal gate are enforced in
Postgres, so they hold for every caller. Row-Level Security decides which rows a
user sees, grants decide which verbs a role has, triggers guard invariants
(immutable role and school, valid answer keys), and composite foreign keys make
cross-school ownership unrepresentable. Privileged endpoints (admin, scheduled
jobs) use separate bearer secrets and the service role.

**Data model:** a school is the tenant. Teachers own classes and quizzes. A quiz
is authored on a canonical, shared video and has questions with options; the
answer key is a flag on the option, independent of language, and display text
lives in per-language translation tables. Assigning a quiz to a class carries
the delivery settings. A student run is an attempt with graded answers. Tutor
exchanges are logged. See [`docs/data-model.md`](docs/data-model.md).

## Design decisions

- **Structural answer key.** Correctness is a flag on the option, so translations
  can never desync what is right.
- **One language rule.** Student preference, then class language, then the quiz's
  base language. Missing translations are filled by AI on demand.
- **Bounded tutor.** Context is the transcript up to the current playhead; it
  never sees the options and is instructed never to reveal an answer.
- **Assignment is the unit of delivery.** Tutor mode, attempts, publish state
  and window belong to the class-quiz pair, so one quiz can run differently per
  class.
- **Edits do not corrupt analytics.** A content edit stamps the quiz; reports
  count only attempts started after the stamp. Nothing is deleted.
- **Transcripts fetched once.** Cached in Storage with a freshness window;
  production egress uses a residential proxy pool because YouTube blocks caption
  downloads from datacenter IPs.
- **Soft delete, then purge.** Scheduled jobs purge deleted quizzes, collect
  orphan videos, reconcile auth users, expire transcripts and close attempt
  windows.

## Testing

Business rules live in SQL, so integration tests drive the real RPCs and RLS
through an actor DSL (school, teacher, student, quiz, attempt) against a fresh
local database per test. Unit tests cover pure TypeScript and route handlers,
component tests cover the UI, and a smoke script drives a running app end to end.

## Further reading

- [`docs/data-model.md`](docs/data-model.md): tables, ER diagram, invariants.
- [`docs/api.md`](docs/api.md): endpoints and the RPCs behind them.
- [`docs/deployment.md`](docs/deployment.md): production environment and jobs.
- [`CLAUDE.md`](CLAUDE.md): local setup, commands and conventions.

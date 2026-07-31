# OrtTube frontend redesign — design

**Date:** 2026-07-14
**Status:** Draft for review
**Owner:** idoshu

## 1. Overview

The backend rebuild (schema, RPCs, `@/lib/*` service layer, `app/api/**` handlers)
is complete and is the source of truth for all business rules. The browser UI was
intentionally gutted down to `app/layout.tsx`, `app/page.tsx`, `app/globals.css`,
and the auth callback route. This project rebuilds the **entire** frontend for both
personas — teacher and student — against the documented HTTP API, and levels it up
to a cohesive, high-end product.

### Goals
- A complete, production-quality UI for both roles over the existing service layer:
  **server components read via `@/lib` + RLS; client mutations go through
  `/api/**`** (no business logic in the client — the DB enforces it).
- One coherent, distinctive visual system: **typeui Glassmorphism (light)**.
- Hebrew-first, RTL throughout; language of content is resolved server-side.
- Respect the load-bearing invariants in the UI: the **reveal gate**, tenant
  isolation, role immutability, and the structural (language-independent) answer key.

### Non-goals / out of scope
- No backend/schema/RPC changes **except** two small read RPCs approved in §11
  (a student attempt-state read for P1 and `get_quiz_for_author` for P2). Reads only
  — no new writes or rule changes.
- No dark theme in this build (the tokens support it; it becomes a later flip — §4).
- No new product features beyond what the API already exposes. Nav items from early
  mockups with no backing (e.g. "שיעורים", "אוטומציות") are **dropped**.
- Admin/cron endpoints are operational, not user-facing; no UI here.

## 2. Visual design system

**System:** typeui **Glassmorphism**, installed as a project skill at
`.claude/skills/typeui-design-system/SKILL.md`. Its tokens and component specs are
**binding** (per the typeui implementation contract), with the fundamentals
guardrails (accessibility, typography, spacing, UI/UX) taking precedence over visual
style where they conflict.

**Committed variant: light-first.** Soft lilac→mint pastel gradient app background,
frosted **white** glass surfaces (`backdrop-filter: blur(20px)`, translucent borders,
glass edge-highlight pseudo-elements top+left), **emerald `#0EA66D`** brand accent,
20px base radius, "glint" buttons, `glass-shadow` elevation.

**Token implementation:** the Glassmorphism tokens are agnostic (not Tailwind
classes). We implement them once as CSS custom properties in `globals.css` (light
values now; dark values stubbed for the later flip) and expose a small mapping to
Tailwind v4 utilities. No raw hex in components — tokens only.

**Adaptations (required by the fundamentals contract):**
1. **Hebrew/RTL font.** Google Sans has no Hebrew. The app font maps to **Rubik**
   (Google-Sans-adjacent, first-class Hebrew), configured at the app level via
   `next/font`. Typographic scale/weights follow `typography.md`.
2. **Contrast on the player.** Glass text must never sit directly over a live,
   variable-brightness video. Checkpoint questions render in a **dark-glass side
   panel / sheet**, not overlaid on the video. All text pairings verified to WCAG
   (4.5:1 body, 3:1 large/non-text).
3. **Mint/brand buttons use ink text, not white** (white-on-mint fails contrast).
   Selection/state always pairs color with a second cue (icon, border, check).

## 3. Architecture

**Data flow (unchanged contract):**
`Server/Client Component → fetch /api/** → @/lib wrapper → SECURITY DEFINER RPC → DB`.

- **Server Components** fetch initial data by calling the `@/lib` service layer
  directly with the SSR Supabase session (RLS is the authorization boundary) for
  read-heavy screens: teacher dashboards/lists, student feed, results. This keeps
  `auth.uid()` correct and avoids client waterfalls. We do **not** add REST endpoints
  solely to feed our own pages — that is the App Router + Supabase best practice, and
  `@/lib` stays the single access point so query shapes and rules stay centralized.
- **Client Components** own interactivity: the quiz player, the streaming tutor,
  the authoring editor, and all forms/mutations (calling `/api/**` over `fetch`).
- **Errors** use the uniform envelope `{ error: { code, message } }`. A single
  client helper maps stable codes → Hebrew user messages + inline/toast presentation.
  HTTP status is already mapped server-side from the code.
- **Role guards** live in the route-group layouts: `/dashboard/*` requires
  `role = teacher`, `/student/*` requires `role = student`; mismatches redirect to
  the correct home. Deactivated teachers are already rejected at sign-in.
- **Language** is resolved server-side (`preferred → class → base`); the client never
  chooses a stored translation. When `served_complete = false`, the player shows a
  subtle "מוצג בשפת המקור" note; a best-effort translation top-up is already handled
  server-side.
- **Next.js (this repo).** Route `params`/`searchParams` are **Promises** — always
  `await` them. Consult `node_modules/next/dist/docs/` for this repo's App Router
  version rather than assuming training-data patterns (per `AGENTS.md`).

## 4. Information architecture & routes

### Shared auth
- `/` — **landing**: audience routing. Teacher value prop + a clear student "join
  your class" path. Single "התחברות" CTA + student-only "הצטרפות עם קוד הזמנה".
- `/sign-in` — **unified** role-agnostic form (email/password). Server returns the
  destination (`/dashboard` or `/student`) and role; the client never sends a role.
  Surfaces **student-only** signup link. Error states: `invalid_credentials` (401),
  deactivated/`no profile` (403), `lookup_failed` (503, retryable).
- `/sign-up` — **student** self-signup, invite-gated (`/api/auth/sign-up-student`).
  Teachers cannot self-register (provisioned via admin) — no teacher signup UI.

### Teacher `/dashboard/*` (role = teacher)
- `/dashboard` — **סקירה (Overview):** welcome, aggregate KPI tiles, classes grid,
  recent activity. KPIs are aggregated **server-side** across the teacher's classes
  via `class_stats` (there is no cross-class rollup RPC); fine at pilot scale.
- `/dashboard/quizzes` — **מאגר המבחנים:** my quizzes (`list_my_quizzes`), the
  same-school **shared catalog** (`GET /api/quizzes/share`), and **clone**
  (`POST /api/quizzes/share`).
- `/dashboard/quizzes/new` and `/dashboard/quizzes/[id]/edit` — **עורך המבחן:**
  create-from-YouTube-URL (`POST /api/quizzes`), questions anchored to a video
  timeline, **AI-generate** (`POST /api/quizzes/[id]/generate`), per-question editor
  (options + structural answer key via `POST /api/quizzes/[id]/questions`),
  **translate** (`POST /api/quizzes/[id]/translate`), publish/share (`update_quiz`).
  Handles `transcript_status` pending/unavailable (generate disabled until ready).
- `/dashboard/classes` and `/dashboard/classes/[id]` — **כיתות:** list/create
  (`/api/classes`), rename/re-language/delete (`PATCH|DELETE`), roster + invites
  (`/roster`, `/students`, `/invites`), assign/unassign quizzes with `tutorMode` +
  `maxAttempts` (`/classes/[id]/quizzes`).
- `/dashboard/analytics/*` — **אנליטיקה:** per-quiz (`/analytics/quiz/[quizId]` —
  completion/attempts/avg score + **distractor distribution** from `question_stats`),
  per-class (`/analytics/class/[classId]` — attempt-based averages vs. roster
  coverage, keeping anonymized attempts distinct), **tutor audit**
  (`/analytics/tutor` — flagged answer-extraction attempts). Analytics is also
  surfaced contextually from each quiz/class, not only as a top-level section.
- `/dashboard/settings` — profile + preferred language.

### Student `/student/*` (role = student)
- `/student` — **הפיד:** class-tabbed assigned quizzes (`list_assigned_for_student`),
  each showing attempt status / attempts-left / score from the student attempt-state
  read (§11-B).
- `/student/quiz/[classId]/[quizId]` — **נגן המבחן:** `get_quiz_for_student` returns
  the answer-free question set + resolved language only. **The delivery metadata the
  player needs — `youtube_video_id`, `tutor_mode`, `max_attempts` — is NOT on that
  read; it comes from the student attempt-state read (§11-B),** which also makes
  refresh/deep-link work without carrying feed state. Start/resume
  (`POST /api/attempts`), video + checkpoint questions, submit-per-question
  (`/answers`), complete (`/complete`). **Ask-AI** drawer streams from `POST /api/ask`
  (client sends `classId`, `quizId`, `prompt`, `positionSeconds`, and optionally
  `attemptId`/`activeQuestionId`); hidden when `tutor_mode = off` (403 `tutor_off` is
  the backstop); transcript is sliced to the current playhead server-side.
- `/student/quiz/[classId]/[quizId]/results` — **תוצאות:** score always; **reveal-
  gated** per-question review (`GET /api/attempts/[attemptId]/review`) only when no
  retake remains. The latest `attemptId` comes from the attempt-state read (§11-B) so
  results survive a revisit/refresh — **critical**, because `start_or_resume_attempt`
  raises `no_attempts_left` at exactly the reveal condition and cannot supply the id.
  `review` returns **IDs only**, so `ReviewList` joins prompt/option text from
  `get_quiz_for_student`, with a fallback label for snapshot questions since
  soft-deleted (absent from the live read). Score-only otherwise; UI never renders
  correctness while retakes remain.
- `/student/settings` — preferred language.

## 5. Component inventory (built once, in P0)

**Foundations:** token layer in `globals.css` (light now, dark stubbed), the app
gradient shell, glass utility/mixin, focus-ring + reduced-motion handling.

**Primitives:** `GlassCard/Panel`, `Button` (brand/secondary/tertiary/ghost/danger +
glint), `SegmentedToggle`/`Pill`, `Badge` (+ count/dot), `Tabs` (underline + pills),
`Field`/`Input`, `Select`/`Dropdown`, `Modal` (focus-trap, `role="dialog"`),
`Sidebar`/`Nav`, `Alert`, `Tooltip`/`Popover`, `Avatar`, `Toast`.

**Data-viz (no library — SVG, tokenized, dataviz-principled):** `StatTile` (value +
trend chip + delta), `RadialGauge`, `AreaChart`/`Sparkline`, `BarDistribution`
(distractor answer distribution), `ProgressSegments`/`Ring`.

**Player-specific:** `VideoStage` (`react-youtube` wrapper with teardown hardening),
`CheckpointScrubber` (nodes at `position_seconds`), `QuestionPanel`, `OptionList`
(single/multi), `AskAIModal` (streaming reader), `ReviewList` (reveal-gated).

## 6. Screen states (applies to every screen)

Each screen specifies: **loading** (glass skeleton/shimmer), **empty** (illustrative
guidance + primary action), **error** (envelope code → Hebrew message, inline vs.
toast), and **success/idle**. Reveal-gated and language-fallback states are explicit
where they apply. Every interactive element defines default/hover/active/focus-
visible/disabled (+ loading/selected where relevant), with keyboard parity.

## 7. Cross-cutting concerns

- **Accessibility (typeui fundamentals, non-negotiable):** measured WCAG contrast in
  the light theme for every color pairing (recorded in the component work), color +
  persistent non-color cue for all state, visible focus, ≥44px targets, 200% text
  resize, RTL reflow. The player's over-video contrast is the highest-risk item.
- **RTL / i18n:** all layout mirrored; content language server-resolved; UI-chrome
  strings in Hebrew (centralized), ready to externalize. Tabular numerals for
  stats/timecodes.
- **Reveal gate:** enforced server-side; the UI additionally never fetches/renders
  per-question correctness while retakes remain.
- **Motion:** one orchestrated page-load reveal (staggered), restrained hover/scroll
  transitions, `prefers-reduced-motion` respected.
- **Responsive:** mobile-first; sidebar collapses to a trigger; player stacks
  video-over-panel on narrow screens.

## 8. Phasing

Each phase is a self-contained implementation-plan chunk. Order after P0 is
**student-loop-first** (highest value, de-risks player/contrast/streaming early).

- **P0 · Foundation.** Token layer + gradient shell + all §5 primitives; both role
  layouts (incl. a **sign-out** control → `/auth/sign-out`) + role routing/guards;
  unified sign-in, student sign-up, split landing. Plus a **seed/fixture path**
  (HTTP authoring/assignment APIs or the `test/helpers/testbed` DSL) that provisions
  a full playable assignment (school → teacher → quiz-on-real-video → class →
  enrolled student → assignment), so P1 is testable before the P2/P3 UIs exist.
  Also sets up **Playwright** (dev dependency) for the headless self-verify loop (§10).
- **P1 · Student core loop.** Feed → player (checkpoints, submit, complete, resume)
  → results/reveal-gated review; Ask-AI streaming drawer with tutor-mode gating.
- **P2 · Teacher authoring.** Create/edit quiz, timeline editor, AI-generate,
  translate, publish/share, quiz library + shared catalog + clone.
  *(Depends on the §11 read decision.)*
- **P3 · Teacher classes & delivery.** Classes CRUD, roster/invites, assignment
  (tutor mode, max attempts), student management.
- **P4 · Analytics & viz.** Overview KPIs + per-quiz/per-class/tutor analytics using
  the §5 data-viz primitives.
- **P5 · Polish.** Motion, empty/loading/error passes, settings, responsive, a11y
  audit against the fundamentals pre-ship checklist.

## 9. Data mapping summary

Every screen binds to the existing service layer (see `docs/api.md`): server
components read via `@/lib`/RLS, client components mutate via `/api/**`. The two new
read RPCs in §11 are the only additions; once they exist, no screen depends on data
the service layer cannot return.

## 10. Verification approach — hybrid, per phase

Each phase runs a **self-verify → fix loop** (autonomous), then a **visual
checkpoint** (human) before the next phase:

**Autonomous self-verify (no reviewer needed):**
- **Behavioral** — drive the running app **headlessly with Playwright** (added as a
  dev dependency in P0): navigate real routes, click/type/submit, and assert against
  the **DOM, network responses, and console** (no reliance on screenshots for
  behavior). Cover the two critical flows: student play→submit→complete→review (with
  the **reveal gate** asserted from both sides) and teacher author→assign→analytics,
  plus role-guard redirects, resume, "no attempts left", and `tutor_mode = off`
  hiding Ask-AI.
- **Accessibility / typeui contract** — axe-core + **computed contrast ratios**
  (measured, not eyeballed), focus order, ARIA, keyboard parity, 200% text resize,
  RTL reflow. The player's contrast is the highest-risk check.
- **Regressions** — `npm run build`/type-check + `npm run lint` + `vitest` green.
- Self-viewed screenshots for obvious layout breakage (overflow, missing styles).

**Human visual checkpoint (end of each phase):** the user does a quick look-and-feel
pass — the gate on aesthetics/polish, where automated checks are weak. Implementation
does not proceed to the next phase until this passes.

## 11. Backend additions (approved) & open questions

Two small `SECURITY DEFINER` **read** RPCs are approved — the only backend work in
this project. Reads only: no new writes, no rule changes; business logic stays in the
existing RPCs/RLS. Re-run `npm run gen:types` and commit `lib/supabase/types.ts` after
adding them.

1. **`get_quiz_for_author(quiz_id)` — blocks full P2 (authoring).** Returns the
   owner's editable quiz tree: quiz meta (`base_language`, `visibility`,
   `transcript_status`, video id/title/duration); non-deleted questions with `kind`,
   `position_seconds`, `order_index`, base `prompt`/`explanation`; options with
   `is_correct`, `order_index`, base `text`; and the set of languages that already
   have translations. Owner-checked; never reachable by students. (Existing reads are
   insufficient: `get_quiz_for_student` is answer-free; `question_stats` is
   analytics-shaped, base-language-only, has **no `explanation`**, and intermixes
   soft-deleted rows.)
2. **Student attempt-state read (§11-B) — blocks the full P1 loop.** e.g.
   `list_my_attempts_for_quiz(class_id, quiz_id)` (or an enriched feed) returning, for
   the signed-in student: `attempt_no`, `completed`, `num_correct`/`num_questions`,
   `attempts_left`, the latest `attempt_id`, plus the delivery context the player
   needs (`youtube_video_id`, `tutor_mode`, `max_attempts`). This one read powers feed
   status chips, the "no attempts left" state, player deep-load/refresh, and —
   critically — **review-on-revisit**, otherwise impossible because
   `start_or_resume_attempt` raises `no_attempts_left` at exactly the reveal condition
   and never returns the id afterward.

**Remaining open question:**
- **Landing content.** How marketing-y should `/` be (full value-prop page vs. thin
  splash)? Affects P0 scope only. Working assumption: a lean single-view landing with
  a teacher value prop + a student "join with invite" path.

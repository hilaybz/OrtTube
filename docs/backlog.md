# Product backlog

Reviewed backlog from the 2026-08-03 planning pass, grouped into epics and
grounded against the current schema and code.

Each task carries a flag:

| Flag | Meaning |
| --- | --- |
| 🎨 **UI only** | Backend already supports it — frontend work alone |
| 🗄️ **Needs migration** | Requires a schema change + `npm run gen:types` |
| 🐛 **Bug** | Built but not working as intended — investigate before estimating |
| ❓ **Decision** | A product question to settle before it can be specified |
| ⚠️ **Constrained** | Not fully achievable as stated — read the note |

Priority suggestions are a starting point, not a decision.

---

## Epic 0 · Transcript fetching (blocker)

The only item that blocks the pilot: **a teacher cannot add a new video in
production.** Everything else in this backlog assumes videos can be added.

| # | Task | Flag |
| --- | --- | --- |
| 0.1 | Switch the primary caption path to the InnerTube ANDROID client. Fixes a verified bug where the watch-page scrape downloads **0 bytes on every IP including local** — production currently runs entirely on an undocumented package internal. | 🐛 |
| 0.2 | Re-probe Vercel after 0.1. If InnerTube is not IP-blocked on AWS, the whole problem is solved for free. | — |
| 0.3 | If 0.2 fails: adopt a paid fetch path behind the same seam. Options priced at ~$3.50–5/month (residential proxy or hosted transcript API). | ❓ |
| 0.4 | Verify the no-transcript experience end to end (below). | ❓ |

### 0.4 · What happens when there is no transcript

Partly addressed in `1fcdc8c`, but never verified as a whole. Three surfaces,
each needing a defined and tested answer:

1. **Adding questions** — AI generation is impossible without a transcript.
   Manual authoring must remain fully available, since it never needed one. This
   is the path the error message directs teachers to, so it has to work.
2. **The warning** — the teacher sees one honest message covering both "this
   video has no captions" and "we couldn't read them right now", because the two
   are often indistinguishable. Retry must be available, not disabled.
   Current copy: *לסרטון זה אין כתוביות או שלא הצלחנו לקרוא אותם כרגע.*
3. **Ask-AI** — **undefined today and the real gap.** The tutor is grounded in
   the transcript up to the student's playhead. With no transcript it has no
   grounding at all. Decide: disable the tutor for that quiz, or let it answer
   ungrounded? Ungrounded answers on a video it cannot see risks confident
   nonsense in front of students. Recommend disabling with a clear reason, and
   surfacing that to the teacher **at assignment time** rather than to the
   student mid-quiz.

---

## Epic 1 · Teacher — quiz library & school catalog

| # | Task | Flag |
| --- | --- | --- |
| 1.1 | Show the **YouTube video title** on quiz cards — in both "my quizzes" and the school catalog. | 🎨 |
| 1.2 | **Delete a quiz** from the library. The `soft_delete_quiz` RPC already exists; this is the button and confirm dialog. | 🎨 |
| 1.3 | **Preview a catalog quiz before cloning** — open it read-only to see the questions, rather than cloning blind. Needs a new correctness-free read; see below. | 🗄️ |
| 1.4 | **Search, filter and sort** in both the library and the catalog. Agree the axes first (video title, question count, language, date, author). | 🎨 |
| 1.5 | **Show which classes a quiz is assigned to**, as tags on the card. | 🎨 |
| 1.6 | General UI pass on the library. | 🎨 |

### 1.3 · Why previewing a shared quiz is not UI-only

There is no read a non-owner can use. `get_quiz_for_author` is strictly
owner-gated and raises `not_owner`
(`supabase/migrations/123_get_quiz_for_author.sql`); `list_shared_quizzes`
returns card metadata only, with no questions.

**Do not widen the gate on `get_quiz_for_author`.** It deliberately exposes the
answer key (`question_options.is_correct`) and the base-language explanations,
because it exists for an owner editing their own quiz. Opening it to every
same-school teacher would circulate the answer key, one leak away from students.

The right shape is a separate correctness-free preview read — questions, options
and prompts, never `is_correct` and never explanations — reusing the read gate
from `clone_quiz` (owner, or `shared` and same school) rather than inventing a
second rule.

### 1.7 · Show school-sharing state distinctly from student visibility 🎨

`quizzes.visibility` (`private` / `shared`) controls only whether *other teachers
in the same school* see the quiz in the catalog. It has nothing to do with
students. The library UI must not blur the two into a single "published" idea.

Student visibility is a per-class property — see **Epic 2A**, which is where
that model is specified.

---

## Epic 2 · Teacher — quiz editor

| # | Task | Flag |
| --- | --- | --- |
| 2.1 | **Video player with a checkpoint timeline** — clickable markers showing where each question sits, as in the previous version. Also unblocks the deferred time-range picker in the AI-generation spec. | 🎨 |
| 2.2 | Delete a quiz from the editor. | 🎨 |
| 2.3 | UI pass on question editing — colour, and possibly a video preview alongside. | 🎨 |
| 2.4 | **Quiz analytics button** from the editor. | 🎨 |
| 2.5 | *Nice to have:* "try it as a student" preview mode. | 🎨 |

### 2.6 · AI difficulty doesn't work 🐛

Flagging this as a **bug, not a feature request** — the difficulty lever shipped
in `5f4bbfe`, so something in the chain is broken. Diagnose before estimating:
is the value not reaching the API, not reaching the prompt, or reaching the
prompt and being ignored by the model? Each has a very different fix.

### 2.7 · Add "mixed" difficulty 🗄️❓

A genuinely new option. Needs a decision on meaning: a spread across the
generated set, or per-question randomisation? Note `medium` currently emits *no*
prompt instruction by design, so "mixed" needs its own explicit rule.

### 2.8 · Reset-analytics prompt on question edit ❓

When a teacher edits a question that students have already answered, ask whether
to reset its analytics or keep them. **Settle the data question first:** existing
answers point at `question_options` rows, so "keep" means old answers are
attributed to changed text. Decide whether that's acceptable, and what "reset"
does to already-graded attempts — it must not alter a student's recorded score.

### 2.9 · Assignment scheduling window

Moved into **Epic 2A** — scheduling is one property of an allocation, not a
standalone feature.

### 2.10 · Ask-AI abuse limits — global, not per teacher

A cap on how many questions a student may ask, and how long a question may be.
These are **platform-level guardrails against abuse and cost, not a teaching
setting** — teachers do not configure them and they are not exposed in the UI.

So this needs **no migration**: application-level configuration, enforced in the
tutor route. Distinct from `class_quizzes.tutor_mode` (`off` / `hints` / `full`),
which *is* a teaching setting and already exists. Pairs with 4.7.

---

## Epic 2A · Assignment, publishing & scheduling

The largest coherent piece of new work, and a model change rather than a UI
change. Numbered `2A` so existing task numbers stay stable.

### The model

**Three independent things, of which the schema currently has two.**

| Concern | Scope | Today |
| --- | --- | --- |
| School sharing | Other *teachers* in the school | `quizzes.visibility` ✅ |
| Assignment | Which classes the quiz is allocated to | `class_quizzes` ✅ |
| **Publication** | Whether *students* in an assigned class can see it | ❌ **missing** |

Right now assignment *is* publication: a `class_quizzes` row means students see
the quiz immediately. The requirement is to split them, so a teacher can allocate
a quiz to classes, set it up, and only then publish.

**An allocation is per class and fully independent.** The same quiz can be
scheduled for one class, live for another, and finished for a third.

Each allocation carries: published state, an optional scheduling window,
`tutor_mode`, and `max_attempts` (the last two already exist).

### Allocation states

| State | Condition | Student sees |
| --- | --- | --- |
| Draft | Not published | Nothing |
| **Scheduled** (מתוזמן) | Published, window starts in the future | Nothing |
| **In progress** (פעיל) | Published, now inside the window — or published with no window at all | The quiz |
| **Done** (הסתיים) | Published, window has passed | Nothing |

Two rules that are easy to get wrong:

- **Publishing without a window is valid and means "available now, indefinitely."**
  The window is optional on both ends.
- **A closed window does not unassign.** The allocation persists — students stay
  enrolled and their attempts, grades and analytics remain intact; only access to
  the quiz and video closes.

### Tasks

| # | Task | Flag |
| --- | --- | --- |
| 2A.1 | Split publication from assignment: add a published state to `class_quizzes`, defaulting to unpublished, and gate the student read path on it. | 🗄️ |
| 2A.2 | Optional scheduling window per allocation — `available_from` / `available_until`, either or both nullable. | 🗄️ |
| 2A.3 | **Allocation management from the quiz edit page** — see and edit which classes a quiz is allocated to, each with its own settings, changeable after the fact. | 🎨 |
| 2A.4 | Show allocation state per class (scheduled / in progress / done) wherever allocations appear — editor, library cards (1.5), classes screens. | 🎨 |
| 2A.5 | Enter a quiz from the class's quizzes tab (was 4.9 in the original list). | 🎨 |

**Enforcement must live in the database.** Publication and window checks belong
in the student-facing RPCs and RLS — `get_quiz_for_student`,
`start_or_resume_attempt`, the assigned-quiz list, and the tutor route — not in
the UI. Per `CLAUDE.md`, business rules hold regardless of caller; a hidden quiz
that is still reachable by direct API call is not hidden.

### 2A.6 · Decision: what happens to an attempt in progress when the window closes? ❓

A student mid-attempt at the closing time can be cut off, or allowed to finish.
Cutting off risks losing their work and grading a partial attempt; allowing it
means the window is not a hard boundary. Needs a decision before 2A.2 is built —
it changes what the RPC does, not just the UI.

---

## Epic 3 · Teacher — new quiz & languages

### 3.1 · Rename "source language" → "quiz language", default from the transcript 🎨

`quizzes.base_language` stays as-is; this is a label and a smarter default. The
transcript fetch already detects and normalises its language, so the detected
value can prefill the field.

### 3.2 · Allowed languages per quiz — scoped to Ask-AI 🗄️

A quiz declares which languages are permitted, and this governs **the Ask-AI
tutor only**: an English lesson restricts the tutor to English; a maths lesson
may allow anything. It does **not** govern question generation (see 3.3).

Needs a new column or join table, a prompt change in the tutor, and a decision
on what happens when a student's preferred language is not allowed — fall back
silently, or answer in an allowed language and say why.

### 3.3 · Questions are generated in the quiz's main language

Generation always produces questions in the quiz's own language — there is no
per-run language picker. Other languages arrive through the existing translation
step, which stays separate.

Mostly a confirmation that current behaviour is correct; the task is to make sure
nothing in the generate UI implies a language choice.

### 3.4 · Edit a quiz's languages after creation 🎨

Depends on 3.2. **Removing a language must not delete existing translations** —
it stops new content being translated into that language, and whether to remove
what is already there is the teacher's decision, made explicitly.

---

## Epic 4 · Student experience

| # | Task | Flag |
| --- | --- | --- |
| 4.1 | UI pass, with a **clear visual distinction between single-answer and multi-answer questions** so students know whether to pick one or several. | 🎨 |
| 4.2 | Search, filter and sort quizzes. | 🎨 |
| 4.3 | **The timeline and its checkpoint markers stay fully visible** — a student sees where the questions are. What must be disabled is *navigation*: clicking a question marker must not seek the video to that point. | 🎨 |

### 4.4 · No seeking forward past unwatched content ❓

Backward seeking allowed, forward blocked. Feasible via the YouTube IFrame API:
track the furthest point genuinely watched and seek back when a student jumps
ahead. Two things to decide — whether the checkpoint question is suppressed
entirely on a forward jump (the note suggests yes), and whether to show any
message or fail silently. *Marked "consult with Gadi".*

### 4.5 · Prevent finding the video on YouTube ⚠️

**Not fully achievable as stated, and worth knowing before it's promised.** The
YouTube embed requires the video ID in the iframe URL, so it is always visible in
DevTools or page source. Anything built here raises the effort of cheating; it
cannot prevent it.

Realistic measures: `modestbranding`, disable related videos, block the context
menu, suppress the title overlay, and remove any plain-text video ID from the
page. A determined student still gets there. Recommend framing this as
"don't make it one click" and putting the real weight on assessment design.

### 4.6 · Ask-AI answers in English 🐛

Should answer in the quiz's language or the student's. The language-resolution
chain already exists (`profiles.preferred_language → classes.language →
quizzes.base_language`), so this is most likely the tutor prompt not being told
which language to use — a bug, not missing infrastructure.

### 4.7 · Ask-AI conversation limits 🗄️

Verify context is preserved across a multi-turn conversation, then bound it:
a cap on questions per attempt, and a character limit per question. Relates to
2.10 (the per-assignment cap) — decide whether limits are global defaults, per
assignment, or both.

### 4.8 · Additional student tabs? ❓

Open question — a grades/history view, or anything else. Needs scoping before it
is a task.

### 4.9 · Unlimited attempts means answers are never revealed 🐛❓

A quiz assigned with unlimited attempts (`class_quizzes.max_attempts` null) never
shows a student the correct answers or the explanations. Not on the first
attempt, not on the tenth, not ever. The results screen only ever offers a score
and a "try again" button.

The gate is working as written —
[`064_get_attempt_review.sql:82`](../supabase/migrations/064_get_attempt_review.sql#L82)
says so outright: *"Unlimited (max_attempts NULL) never reveals per-question
detail."* Reveal is conditioned on having **exhausted** your attempts, and
unlimited attempts can never be exhausted, so the condition is unsatisfiable.

**The copy promises something that cannot happen.** The screen reads *"פירוט
התשובות והנימוקים ייחשף לאחר שלא יישארו ניסיונות נוספים"* — details will be
revealed once no attempts remain. Under unlimited that moment never arrives. Even
if the behaviour is kept, this sentence has to change.

**Why it is a design question and not just a bug.** The gate exists so a student
cannot read the answer key and then retake with it, which is exactly the risk
unlimited attempts create — so "never reveal" is internally consistent. It just
makes the most formative setting a teacher can choose the one that gives students
the least feedback, which inverts the intent: a teacher granting unlimited
retakes has already signalled this is practice, not assessment.

Options:

| | Option | Note |
| --- | --- | --- |
| a | **Treat unlimited as formative**: reveal after every completed attempt | No schema change. Follows the teacher's own signal — unlimited retakes means practice. A student can then retake with the answers, which under unlimited attempts is already true of anyone willing to brute-force. |
| b | **Reveal explanations but not correctness** | Unreliable: explanations routinely give the answer away, which is why `get_quiz_for_student` withholds them entirely. Would need every explanation written to a rule nobody is enforcing. |
| c | **A per-assignment "show answers after completion" setting**, independent of attempt count | 🗄️ The fullest answer: makes formative-vs-assessed an explicit teaching decision rather than something inferred from `max_attempts`. Belongs with the other per-allocation settings in **Epic 2A**. |

Recommend (a) now, since it is small and unblocks the pilot, and (c) later as part
of 2A — at which point (a) becomes the default value of the new setting rather
than a hardcoded rule.

Note the column default is `max_attempts int default 1`, so this only bites when
a teacher deliberately chooses unlimited. It is not the out-of-the-box path.

---

## Epic 5 · General

| # | Task | Flag |
| --- | --- | --- |
| 5.1 | **Site language: Hebrew / English / Arabic.** Large — UI strings are currently hardcoded Hebrew, so this needs an i18n layer before any translation work. Estimate it separately from everything else here. | 🗄️ |
| 5.2 | Show-password toggle on the sign-in form. | 🎨 |

---

## Epic 6 · Design questions (not yet tasks)

- **6.1 — What should the teacher landing/overview page be?** Currently
  undefined. Needs a decision on what a teacher sees first: recent quizzes,
  class activity, things needing attention, or a summary.
- **6.2 — Do teachers need to belong to more than one school?** See
  [`open-questions.md` §1](open-questions.md). Deferred pending evidence: the
  migration path (`profiles.school_id` → a `teacher_schools` join table) stays
  clean, so waiting is cheap — but if multi-school teaching turns out to be
  routine, build it **before** the pilot rather than migrating live tenant
  isolation afterwards.

---

## Epic 7 · Technical debt & carried-over work

Open items from previous sessions, recorded here so they stop living in chat
history.

### 7.1 · Remove `quizzes.cloned_from_id` 🗄️

**Decision made:** drop the column. Clones are eager deep copies with no runtime
coupling, so it carries no behaviour — only provenance we have decided not to
keep. Removing it also retires three of the open sub-questions in
[`open-questions.md` §2](open-questions.md) (provenance lost on hard delete,
provenance never surfaced, clone chains), which exist only because the column
does.

Touches:

- `supabase/migrations/010_schema.sql` — the column and its self-FK
- `supabase/migrations/015_indexes.sql:25` — `idx_quizzes_cloned_from`
- `supabase/migrations/080_sharing_rpcs.sql` — the `INSERT` column list plus
  the header comment
- `lib/sharing.ts:64` — doc comment
- `test/helpers/testbed/inspector.ts`, `test/sharing/sharing.int.test.ts` — two
  assertions reference it
- `docs/data-model.md` — ER diagram and prose
- `lib/supabase/types.ts` — regenerate with `npm run gen:types` **after**
  `supabase db push`

**Note before doing it:** this is a one-way door. Once dropped, existing clone
lineage is gone and cannot be reconstructed. Cheap to keep, cheap to drop —
worth one confirmation that nothing downstream (analytics, attribution, any
future "cloned from" credit) is expected to want it.

### 7.2 · Finish the AI-generation spec — step 5, topic-hint focus

The last unbuilt step of `docs/superpowers/specs/2026-07-30-ai-generation-options.md`.
Steps 1–4 shipped. The time-range half is deliberately deferred until the
checkpoint timeline (2.1) exists; only the topic hint is in scope.

### 7.3 · `422 generation_failed` when appending to a covered quiz 🐛

Generating additional questions for a quiz that already covers the video fails.
**Reproduces locally**, so it is unrelated to deployment. Never diagnosed.

### 7.4 · Ask-AI context gap on long videos

The tutor slices the transcript to roughly the last 8,000 characters before the
playhead, so a student 50 minutes into a video loses all earlier context. Noted
previously as: full transcript for short videos, an AI summary for long ones.
Overlaps with 4.7 — decide together.

### 7.5 · P5 polish (frontend redesign)

The one unbuilt phase of ido's frontend plan: motion, empty/loading/error
passes, responsive, and an a11y audit. Its plan file was never written. The UI
tasks scattered through Epics 1–4 cover part of this; worth deciding whether P5
survives as its own phase or is absorbed.

### 7.6 · Extract generation enums to an SDK-free leaf module

Low-severity review finding. The generation option enums (`difficulty`,
`optionsPerQuestion`, `questionType`) live alongside SDK-importing code, which
forced test mocks to pull in more than they need.

### 7.7 · Pin clone independence with a test

Twelve integration tests cover cloning, but **none assert that editing a clone
leaves the source unchanged** — the property teachers actually rely on. Add it
in both directions. See [`open-questions.md` §2](open-questions.md).

### 7.9 · `videos.title` / `duration_seconds` can stay null forever 🐛🗄️

`create_quiz_for_video` upserts the video row with
`on conflict (youtube_video_id) do nothing`
(`supabase/migrations/041_quiz_authoring_rpcs.sql:90-92`), and nothing backfills
either column. So the **first quiz ever created on a video** sets its metadata
permanently — if that fetch failed at that moment, the field stays null for
every teacher, with no recovery from the UI.

Latent today (0 nulls live, oEmbed answers fine from a residential IP), but
`duration_seconds` comes from the watch-page scrape, which is already known to
be blocked on Vercel. Same shape as the transcript bug fixed in `1fcdc8c`: a
transient upstream failure recorded as a permanent fact.

Cheapest fix is `coalesce(videos.title, excluded.title)` on the upsert, so a
later quiz on the same video repairs the gap for free.

### 7.8 · Decide: escalate `hard` difficulty to a stronger model? ❓

Open decision 3 in the generation spec, marked "decide from eval, default no."
No eval was ever run; it is currently defaulted to no. Blocked on 2.6 — there is
no point evaluating a lever that does not work.

---

## Epic 8 · Housekeeping

Small, unblocked, none of it urgent.

| # | Task |
| --- | --- |
| 8.1 | Delete the `yt-probe` Supabase Edge Function — a throwaway spike, still deployed: `npx supabase functions delete yt-probe` |
| 8.2 | Delete four merged remote branches: `chore/vercel-deploy`, `feat/hebrew-ui-polish`, `fix/transcript-fetch`, `frontend-redesign` |
| 8.3 | Check `feat/generate-question-type` before deleting — git reports it **not merged** even though its work landed in `ecc80fe`, because the branch was rebased. Confirm nothing unique is on it. |
| 8.4 | Verify Vercel → Settings → Cron Jobs lists all four jobs |
| 8.5 | Rotate `ADMIN_SECRET` / `CRON_SECRET`. *Deferred by decision — recorded for completeness.* |

---

## Suggested sequencing

1. **Epic 0** — nothing else matters if videos can't be added.
2. **The three bugs** (2.6 difficulty, 4.6 Ask-AI language, 4.7 context) — these
   are things believed to work that don't, which is worse than a missing feature.
3. **Cheap high-value UI** (1.1, 1.2, 1.3, 5.2, 4.1) — small, independent, and
   they make the app feel finished.
4. **The timeline (2.1)** — unlocks several other items including the deferred
   AI-generation focus picker.
5. **Epic 2A (assignment & publishing)** — the largest coherent feature, and a
   model change. Worth its own plan rather than being filed as loose tasks.
6. **Remaining migration-bearing work** (3.2, 7.1) — batch with 2A so the schema
   changes land together, in one `gen:types` pass.
7. **Site i18n (5.1)** — large enough to deserve its own plan.

Epic 7 is mostly independent and can fill gaps, with two exceptions: 7.8 is
blocked on 2.6, and 7.1 should ride along with the other migrations. Epic 8 is
five minutes of work whenever convenient.

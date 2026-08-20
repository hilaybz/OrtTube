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
| 0.1 | ~~Switch the primary caption path to InnerTube ANDROID.~~ **Done / moot** — `852b3d0`. The package already used ANDROID InnerTube; the dead watch-page download is deleted. | ✅ |
| 0.2 | ~~Re-probe Vercel.~~ **Answered: blocked.** `not_playable:LOGIN_REQUIRED` from a preview deployment. Not free after all. | ✅ |
| 0.3 | ~~Paid egress behind the `fetchFreshTranscript` seam.~~ **Done, and free.** Proxy pool in `lib/egress.ts`; the free tier turned out to be enough. See below. | ✅ |
| 0.4 | Verify the no-transcript experience end to end (below). Tutor behaviour decided; blocked on 0.5. | ❓ |
| 0.5 | Make "has no transcript" a property of the quiz rather than of request timing. Blocks 0.4 and, until settled, makes tutor availability differ between students in the same class. | ❓ |

### Confirmed 2026-08-13 — YouTube bot-checks Vercel's egress

Logged from a preview deployment:

```
[transcript] video=tvyOITo5iOk transient failure reason=not_playable:LOGIN_REQUIRED
```

`LOGIN_REQUIRED` is YouTube's "sign in to confirm you're not a bot". The watch
page returns 200, parses, and lists zero caption tracks — indistinguishable from
a caption-less video, which is the trap `1fcdc8c` guards against.

It is the IP, not the code:

- The same video returns **176 Hebrew ASR segments** from a residential IP.
- The failure shape was byte-identical across two days, two deployments and both
  environments. A rate limit drifts; a standing block does not.
- `youtube-transcript` already posts an **ANDROID** client context — the swap
  0.1 proposed was already what ran, and it is what is refused.

**Two things to do together in 0.3.** Route egress through the
`fetchFreshTranscript` seam, and cut the request count while you are there: one
attempt currently makes up to **11 requests, six of them ~1.2 MB watch pages —
about 7 MB per video**, because `LANG_PREFERENCE` tries five languages in full.
The scrape already returns the track list, so the language is known before
downloading: read it off there and make one call. Two requests instead of eleven,
and ~5× less metered traffic.

**Wider than AI generation:** `duration_seconds` comes from the same scrape, so
it is null in production too. Titles come from oEmbed and appear unaffected.

Issues #7 and #8 are closed with this evidence; #9 carries the path forward.

### Resolved 2026-08-20 — 0.3 shipped, and it cost nothing

The assumption baked into 0.3 was that **datacenter** proxies would be refused
exactly like Vercel's, so only residential egress could work. Measured against
Webshare's *free* tier (10 datacenter proxies, $0) with `npm run probe:proxy`:

| | Watch page | InnerTube |
| --- | --- | --- |
| `31.56.127.193` (US) | OK, 1 track | OK, 1 track |
| `84.247.60.125` (PL) | OK, 1 track | OK, 1 track |
| `45.38.107.97` (UK) | HTTP 429 | OK, 1 track |
| other 7 | 429 / LOGIN_REQUIRED | LOGIN_REQUIRED |

**3 of 10 clear the check**, so the assumption was wrong and no payment is
required yet.

**Which** 3 is not stable, though, and that matters more than the count. Two
back-to-back runs were byte-identical, which looked like a fixed per-IP
property. Two hours later the membership had moved: `31.59.20.176` and
`191.96.254.138` had recovered, `45.38.107.97` had been burned, and the count
was 4. Treat any single probe run as a snapshot, never as a roster — the earlier
reading of it as a standing property was simply too few samples.

That churn is designed for rather than papered over: `lib/egress.ts` treats the
pool as mostly-burned and membership as unknown, skipping any exit that answers
429 or a bot check and remembering the one that just worked, so a request pays
for a dead proxy at most once per instance and recovers on its own when the pool
shifts underneath it. If it decays past usefulness, **the fix is the value of
`YOUTUBE_PROXY_URLS`, not a code change** — the pool interface is identical for
one paid residential endpoint.

Two traps worth recording, both of which produced confident wrong answers first:

- **Node's global `fetch` rejects a `dispatcher` built by a separately-installed
  undici** (`UND_ERR_INVALID_ARG`), surfaced as a bare `TypeError: fetch failed`
  that is indistinguishable from an unreachable host. Every proxy looked dead,
  and the probe concluded datacenter IPs cannot clear the check. Proxy code must
  import `fetch` from `undici`.
- **A probe run from a dev machine proves nothing unless it checks its own exit
  IP.** A residential IP already works, so a proxy that silently falls back to
  direct returns a perfect transcript and reads as success.

The request-count cut landed with it: the download now reads its language off
the track list the scrape already returned and makes **one** call instead of up
to five, taking ~7 MB per video down to ~1.5 MB.

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
3. **Ask-AI** — see 0.5. **Decided: disable the tutor** when the video has no
   transcript, rather than let it answer ungrounded — confident nonsense about a
   video it cannot see is worse than a missing button. Not yet built, because
   "has no transcript" is not currently a knowable fact about a quiz. That is
   0.5.

### 0.5 · "Has no transcript" is not a property of a quiz today ❓

Blocks the 0.4 decision above. Deferred deliberately — worth settling before any
tutor gate is written, because the gate has nothing dependable to read.

**Nothing ever fetches a transcript proactively.** `create_quiz_for_video` leaves
`transcript_status` at its `'pending'` default, and the only two triggers are the
generate route and the tutor route itself. `sweep-transcripts` sounds like it
would help and does the opposite — it *deletes* Storage objects past their TTL.
Three consequences:

- **`pending` means "nobody has looked", not "no captions".** A gate keyed on
  `unavailable` never fires for the case we actually have in production, where a
  blocked fetch deliberately leaves the status untouched.
- **A manually-authored quiz never triggers a fetch at all.** If the teacher
  never presses "generate with AI", no transcript is ever requested, so the video
  has no known caption state at the moment students start using it.
- **Availability is decided per student request, so it differs between students
  in the same class.** The tutor route calls `getTranscript` on every question.
  Whoever asks first triggers the fetch; if it succeeds the transcript is cached
  and everyone after them gets a grounded tutor, and if it fails the claim marker
  throttles the next callers for `CLAIM_TTL_MS` and they get nothing — without
  even attempting. Over a longer horizon the TTL sweep deletes the object and the
  next request re-fetches, so a quiz that worked in September can stop working in
  October.

**That last one is the reason this outranks the tutor-prompt question.** It is
not only inconsistent, it is an assessment-fairness problem: two students sitting
the same quiz get materially different help based on who clicked first and
whether YouTube happened to answer. That is invisible to the teacher and to both
students.

**The invariant to design to:** tutor availability must be a property of *the
quiz*, decided once and the same for every student in the class — never a
side effect of request timing.

Three options, not mutually exclusive:

| | Option | Note |
| --- | --- | --- |
| a | **Resolve caption state when the video is added**, and let that define behaviour uniformly | Makes `pending` a real transient state rather than a permanent unknown. Costs one fetch per new video at the moment a teacher is already waiting, and needs a defined answer for "the fetch was blocked" — which, on the current egress, is the common case, so it cannot simply mean "no captions" (that was the `1fcdc8c` bug). |
| b | **Let the students who can, use it** | Cheapest, and explicitly accepts the fairness problem above. Reasonable only if the tutor is positioned as a bonus rather than part of the assessment. |
| c | **Give the tutor a short summary of what the video is about**, so it has topical context without a transcript | The most interesting: it changes the tutor from *blocked* to *usefully bounded* — it can say what the video covers and answer around the subject, while being honest that it cannot see what was said. Note the summary cannot come from the transcript in this case; it would come from title/description metadata, or from the teacher. Overlaps directly with the teacher-materials idea, and with 7.4, where the same summarisation machinery is wanted for *long* videos that do have transcripts. |

Worth deciding (a) and (c) together — (a) makes the state knowable, (c) decides
what to do with the answer. (b) is the do-nothing baseline to measure them
against.

---

## Epic 1 · Teacher — quiz library & school catalog

| # | Task | Flag |
| --- | --- | --- |
| 1.1 | Show the **YouTube video title** on quiz cards — in both "my quizzes" and the school catalog. | 🎨 |
| 1.2 | ~~**Delete a quiz** from the library.~~ **Done** — `bdb0903`. | ✅ |
| 1.3 | ~~**Preview a catalog quiz before cloning** — open it read-only to see the questions, rather than cloning blind.~~ **Done** — migration `134_quiz_preview.sql` (`get_quiz_for_preview`, gated exactly like `clone_quiz`: owner, or `shared` and same school) + `components/teacher/library/QuizPreviewModal.tsx`. Reverses this item's original note: the preview shows the **full quiz, correct answers and explanations included** — see the note below. | 🗄️✅ |
| 1.4 | ~~**Search, filter and sort** in both the library and the catalog.~~ **Done** — `lib/libraryFilters.ts` (pure, dependency-free) + `components/teacher/library/QuizLibrary.tsx`, entirely client-side (neither `list_my_quizzes` nor `list_shared_quizzes` paginates). Each tab keeps independent state. Search: "My quizzes" matches quiz/video title + the video's channel name (`channel_name`, now also selected by `list_shared_quizzes` — migration `133_shared_quiz_channel_name.sql` — so the catalog can search AND display it); "School catalog" additionally matches the authoring teacher's name. Filters: language (both tabs, multi-select OR), plus a class-assignment filter on **"My quizzes" only** (multi-select OR over `list_my_quiz_allocation_tags`, including an explicit "not assigned" option) — the catalog tab has no visibility into other teachers' allocations, a real RLS boundary, not a gap. Sort: created date and question count, each ascending/descending. | 🗄️✅ |
| 1.5 | ~~**Show which classes a quiz is assigned to**, as tags on the card.~~ **Done** — `components/teacher/QuizCard.tsx` (`list_my_quiz_allocation_tags`), shared by the library and the new dashboard landing section (see 6.1). | ✅ |
| 1.6 | General UI pass on the library. | 🎨 |
| 1.8 | ~~**Small video thumbnail** on a "my quizzes" card.~~ **Done** — `components/teacher/QuizCard.tsx`, derived client-side from `youtube_video_id` (already returned by `list_my_quizzes`), no migration. Extended to the school catalog tab too (`QuizLibrary.tsx`'s `SchoolTab`) alongside 1.3, since that card markup was already being touched for the preview button. | ✅ |
| 1.9 | ~~**Show the video's creator/channel name** under the title on a "my quizzes" card.~~ **Done** — migration `132_video_channel_name.sql` adds `videos.channel_name`, fetched via the same oEmbed call `title` already uses (no extra request, and unaffected by Epic 0's blocked egress), following 125's "never downgrade, backfill on conflict" pattern. `components/teacher/QuizCard.tsx`. Existing videos backfill only the next time a quiz is created on them. | 🗄️✅ |

### 1.3 · Why previewing a shared quiz was not UI-only, and why the answer key is shown after all

There was no read a non-owner could use. `get_quiz_for_author` is strictly
owner-gated and raises `not_owner`
(`supabase/migrations/123_get_quiz_for_author.sql`); `list_shared_quizzes`
returns card metadata only, with no questions. The fix is a separate
`get_quiz_for_preview` RPC (`134_quiz_preview.sql`), gated exactly like
`clone_quiz` (owner, or `shared` and same school) rather than widening
`get_quiz_for_author`'s own gate — the editor page assumes "if I can fetch
this, I own it" throughout (edit/delete/drag controls render
unconditionally), so widening that RPC without rebuilding the page would let
a non-owner load a UI full of controls that silently fail ownership checks.

**Revised from this item's original note**: the preview was first specified
as correctness-free (no `is_correct`, no `explanation`), reasoning that
exposing the answer key to any same-school teacher is "one leak away from
students." That doesn't hold up — **cloning already hands a same-school
teacher the full answer key immediately** (a deep copy, editable in their
own editor from then on), so hiding it in the preview only adds friction
(clone-to-see-answers) without adding any real protection. The preview
therefore shows the **full quiz** — correct answers and explanations
included — so a teacher can actually judge it before deciding to duplicate
it. What's still enforced is the real trust boundary: a different-school
teacher, a student, or a same-school teacher previewing someone's private
(non-shared) quiz all get `not_authorized`, same as `clone_quiz`.

The preview UI itself reuses the editor's own building blocks rather than a
separately-designed summary — `VideoPreviewPanel` (its
`onMarkerMove`/`onClusterMove` loosened to optional, so it's read-only
automatically without a new "mode" flag) and a newly-extracted
`QuestionListItem` (pulled out of `QuizEditor.tsx`'s inline question `<li>`,
with `onEdit`/`onDelete` now optional) — so the preview and the real editor
render through the identical code path and can't visually drift apart.

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
| 2.1 | ~~**Video player with a checkpoint timeline**~~ **Done** — `components/video/CheckpointTimeline.tsx` (generic, no quiz-shaped props — reusable for the deferred AI-generation time-range picker) + `components/teacher/editor/VideoPreviewPanel.tsx`. Duration is read from the player itself (`onProgress`), never from `videos.duration_seconds` — that column is null for most quizzes in production today (Epic 0's blocked scrape fetches it too). Markers are click-to-seek and click-to-select (highlights the matching question card below); a marker is draggable to reposition, reusing the existing question-upsert endpoint (no new API); questions sharing a timestamp collapse into one marker with a count badge and a picker popover instead of overlapping. `QuestionModal` also gained a "מהזמן הנוכחי בנגן" button that prefills the position field from the live preview. | ✅ |
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

### 2.10 · Ask-AI abuse limits — global, not per teacher ✅

**Closed** — issue #26. Built in July, before the planning pass that filed it:
the 1000-char cap in `f9827b9` and the 10/60s rate limit in `bcbcf7e`.

A cap on how many questions a student may ask, and how long a question may be.
These are **platform-level guardrails against abuse and cost, not a teaching
setting** — teachers do not configure them and they are not exposed in the UI.

So this needs **no migration**: application-level configuration, enforced in the
tutor route. Distinct from `class_quizzes.tutor_mode` (`off` / `hints` / `full`),
which *is* a teaching setting and already exists. Pairs with 4.7.

### 2.11 · Questions are ordered by authoring order, not video time ✅

**Fixed** by migration `126_order_questions_by_video_time.sql` plus the matching
client sort. Kept here until the next backlog reconciliation pass. Original
report below.


**Reported as an editor display nit; it is a student-facing bug.** Reproduce by
adding questions at 0:30, then 1:30, then 0:30. The editor lists them in that
order rather than 0:30, 0:30, 1:30.

`order_index` is assigned as `max + 1` on insert
([`QuizEditor.tsx:229`](../components/teacher/editor/QuizEditor.tsx#L229)), so it
records **when the teacher wrote the question**, and every consumer sorts by it
with `position_seconds` as a mere tiebreak:

- `get_quiz_for_author` — `order by q.order_index, q.position_seconds, q.id`
- `get_quiz_for_student` — `order by sub.q_order, sub.q_pos, sub.q_id`
- `QuizPlayer` — `sort((a, b) => a.order_index - b.order_index)`

The student consequence is the serious half. The player picks the next
checkpoint as *the first unanswered question in `order_index` order*, and gates
the video at its `position_seconds`. With the sequence above, a student who has
just answered the 1:30 question is handed the second 0:30 question, whose gate is
a minute behind the playhead — so `gateDecision` returns a `clampTo` and **the
video seeks backwards to 0:30**. A teacher inserting an early question after a
later one silently makes the video jump back for every student.

`rewatch()` already picks the previous checkpoint by `position_seconds`, so the
player is half time-ordered and half insertion-ordered today.

**Recommended fix:** sort by `position_seconds` first, with `order_index` as the
tiebreak for two questions at the same timestamp — three sort clauses and no data
migration. `order_index` keeps its real job (stable ordering within a timestamp,
and the frozen `attempt_questions` snapshot); it just stops outranking time.

Decide one thing before building: whether an **in-progress attempt** should keep
the order it started with. Re-sorting mid-attempt moves a student's remaining
questions around. The snapshot is per attempt, so either answer is implementable
— it needs choosing, not discovering.

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
| 2A.1 | ~~Split publication from assignment: add a published state to `class_quizzes`, defaulting to unpublished, and gate the student read path on it.~~ **Done** — `127_class_quiz_publish_state.sql`. The RPC parameter defaults `true` (assignment stays instantly visible unless a teacher opts into a draft), only the column defaults `false`; a new `set_class_quiz_published` RPC + `AssignedQuizzesSection` toggle let a teacher flip it after the fact. | ✅ |
| 2A.2 | ~~Optional scheduling window per allocation — `available_from` / `available_until`, either or both nullable.~~ **Done** — `128_class_quiz_scheduling_window.sql` / `129_attempt_window_finalization.sql`. Hard cutoff (decision below); `set_class_quiz_schedule` RPC + the assign flow's window fields. | ✅ |
| 2A.3 | ~~**Allocation management from the quiz edit page** — see and edit which classes a quiz is allocated to, each with its own settings, changeable after the fact.~~ **Done** — `components/teacher/editor/AllocationsSection.tsx` (`list_quiz_allocations`), including bulk-assign to several classes at once (`components/teacher/editor/BulkAssignModal.tsx`, `POST /api/quizzes/[id]/allocations`) — the cluster-assignment flow this epic was blocking. | ✅ |
| 2A.4 | ~~Show allocation state per class (scheduled / in progress / done) wherever allocations appear — editor, library cards (1.5), classes screens.~~ **Done** — one shared `allocationState()` (`lib/allocationState.ts`) drives the state badge in the editor's `AllocationsSection`, the class page's `AssignedQuizzesSection`, and (as `זמין:`/`מתוזמן:` chips rather than a single badge) the library/dashboard `QuizCard`. | ✅ |
| 2A.5 | Enter a quiz from the class's quizzes tab (was 4.9 in the original list). | 🎨 |

**Enforcement must live in the database.** Publication and window checks belong
in the student-facing RPCs and RLS — `get_quiz_for_student`,
`start_or_resume_attempt`, `list_my_attempts_for_quiz`, the assigned-quiz list,
and the tutor route — not in the UI. Per `CLAUDE.md`, business rules hold
regardless of caller; a hidden quiz that is still reachable by direct API call
is not hidden. All five now share one SQL predicate, `_allocation_is_live(cq)`
(`128_class_quiz_scheduling_window.sql`).

Bulk-assign (2A.3) is a server-side loop over `assign_quiz_to_class` — one
independent allocation per selected class, no new atomic multi-row RPC — per
the ad hoc (non-persistent-group) shape decided for cluster-assignment.

### 2A.6 · Decision: what happens to an attempt in progress when the window closes? ✅

**Decided: hard cutoff.** If a window closes at 18:00 and a student is
mid-attempt, at 18:00 it is as if they submitted — unanswered questions count
wrong, scored on whatever they'd actually answered. Two interactive paths
force-finalize in place (`submit_answer` on the next answer attempt,
`complete_attempt` if the student clicks submit late — both backdating
`completed_at` to the window's close, never wall-clock `now()`), plus a daily
cron sweep (`close_expired_attempt_windows`) for attempts nobody came back to
interact with — daily, not hourly, because Vercel's Hobby plan rejects any
faster cron schedule outright (confirmed by a failed deployment); tighten it
if the project ever moves to a paid tier. The player enforces the cutoff
client-side too, timed off a clock-skew offset computed from the server's
clock at page load — not a countdown (the due date lives in the student feed
instead) — so a student actually watching gets a clean transition to their
results the instant the window closes, without waiting for the daily sweep.
Full detail in `docs/data-model.md`'s `class_quizzes` entry.

**One thing this deliberately does NOT cover: what a teacher (or the student
feed) sees once an allocation's window has closed.** See the new item below.

### 2A.7 · A quiz has finished — now what? ❓ (issue #69)

Closed-window allocations are intentionally invisible everywhere a "current
state" chip appears — the editor's own allocations list still shows them (as
`הסתיים`), but the library/dashboard `QuizCard` tags and the student feed both
just drop them, the same way a draft or unpublished allocation always has.
That's consistent, but it leaves a real gap: nothing tells a teacher a quiz
has ended and results are ready, and a student who completed a windowed quiz
last week can no longer find it in their feed (though the results page itself
still works if they have the link — `findLatestCompletedAttempt` in
`lib/attempts.ts` reads a student's own `attempts` rows directly, independent
of the allocation's current state, precisely so a closed window never erases
access to a student's own results).

Worth scoping as a real feature rather than a chip fix: a notification when a
quiz's window closes and results are in, and/or a "recently finished" surface
on both the teacher dashboard and the student feed. The data already exists
(`available_until`, plus `close_expired_attempt_windows` finalizing every
attempt) — this is a product/UX decision, not blocked infrastructure.

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
| 4.2 | ~~Search, filter and sort quizzes.~~ **Done** — the student-side twin of 1.4: `lib/studentFeedFilters.ts` (pure; reuses 1.4's `matchesText`) + `components/student/StudentFeed.tsx`, entirely client-side (`list_student_feed` returns the whole feed in one query and never paginates). ONE control bar governs both feed sections — a student looking for a quiz doesn't know which section it landed in. Search: quiz title + video title + class name + teacher name. Filters: class (multi-select OR, shown only once the student is in more than one class) and status (`טרם התחלת`/`בתהליך`/`הושלם`/`פוספס`) — a status selection that empties a whole section drops that section instead of leaving it standing empty. Sort: submission deadline only, both directions (soonest first is the default) — the one ordering a student actually asks for; a quiz with no deadline sinks to the end under BOTH directions rather than flipping to the top. Language is deliberately NOT a filter axis here: a student reads every quiz in their own resolved language, so it would be a no-op. | ✅ |
| 4.3 | ~~**Checkpoint markers stay visible; only navigation is disabled.**~~ **Done** — `c906c7c`, pinned by `test/ui/QuizPlayerCheckpoints.test.tsx`. | ✅ |

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

### 4.6 · Ask-AI answers in English ✅

**Done** — `da19c4f` restates the response language at the end of the tutor user turn.

Should answer in the quiz's language or the student's. The language-resolution
chain already exists (`profiles.preferred_language → classes.language →
quizzes.base_language`), so this is most likely the tutor prompt not being told
which language to use — a bug, not missing infrastructure.

### 4.7 · Ask-AI conversation limits ✅

**Closed** — issue #43. Bounds are all in place; the per-quiz budget was the
missing piece.

Most of this is already built — see 2.10. What is in place today, all in
`app/api/ask/route.ts` unless noted:

| Cap | Value |
| --- | --- |
| Question length | 1000 chars, on the prompt and on each history turn |
| Rate | 10 requests / 60s per user (in-memory, per serverless instance) |
| History depth | last 6 turns, forced to alternate |
| Response length | 400 tokens (`TUTOR_MAX_TOKENS`) |
| Transcript context | ~2000 tokens before the playhead (`TRANSCRIPT_TOKEN_CAP`) |

Context **is** preserved across turns, but it lives in the browser: `AskAI` holds
the messages in React state and posts them back as `history`. Nothing server-side
feeds context, so a refresh or a second device starts over, and only the last six
turns survive.

#### 4.7a · Total questions per quiz ✅

**Built** — `MAX_QUESTIONS_PER_QUIZ` in `app/api/ask/route.ts`. At the cap the
tutor stops answering: 403 `question_limit_reached`, no Claude call, nothing
logged. Teacher visibility and reset were not built — it stays invisible platform
machinery, like the rate limit.

**Decided.** A per-*attempt* cap is worthless here: `max_attempts` may be null,
and a student who exhausts a per-attempt budget simply starts another attempt. The
cap has to sit above the attempt.

- **Unit:** one budget per student per quiz, spanning **all attempts**. Scope the
  count to `(student_id, class_id, quiz_id)` — `tutor_questions` carries all
  three, and a quiz can be assigned to more than one class, so keying on the
  assignment keeps two classes from sharing one budget.
- **Lifetime, not per day.** A student who spends it has spent it.
- **Keep the 10/60s rate limit.** Different jobs: the rate limit stops a script,
  this stops sustained grinding.
- **Suggested value: 200.** Deliberately generous — abuse is not judged likely;
  this is a backstop, not a barrier.

Cheap to build: `tutor_questions` already records every question, so this is a
`count(*)` in the tutor route. No migration. One caveat — `student_id` is nullable
and set null on anonymisation, so anonymised rows stop counting toward it, which
is fine for a guardrail.

**Two things still undefined:**

1. **What the student sees at the cap.** The tutor going quiet mid-quiz is the
   same dead end as 4.9 — it needs honest copy, not a bare 429. And decide whether
   a teacher can see the count or reset it, or whether it stays invisible platform
   machinery like the rate limit.
2. **It bounds behaviour, not spend.** The ceiling is
   `students × quizzes × 200`; 30 students across 10 quizzes is 60,000 questions,
   each costing roughly 4,000 input tokens plus up to 400 output. If the goal is
   protecting the bill rather than fairness between students, only an aggregate
   (school- or day-level) cap does that.

#### 4.7b · Conversation history is client-supplied and unverifiable

**Not required — moved to issue #64 as a suggestion.** `sanitizeHistory` checks
the shape of the history a client posts but cannot establish that the model said
any of it, so a forged assistant turn is possible.

Impact is narrower than it first appears: the answer key is never in the tutor's
context and the transcript is playhead-bounded, so nothing can be extracted that
was never sent. What it buys is bypassing `tutor_mode` and misusing the endpoint.

Worth doing mainly for the side effect — reading history from `tutor_questions`
would also stop a refresh wiping the conversation.

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

- **6.1 — What should the teacher landing/overview page be?** ~~Currently
  undefined.~~ **Partially answered**: the dashboard now shows a "החידונים שלי"
  section (`app/(teacher)/dashboard/page.tsx`) — every quiz with at least one
  allocation, as `QuizCard`s tagged `זמין:`/`מתוזמן:`, above the existing
  class-summary grid. Still open: whether "things needing attention" (see
  2A.7) belongs on this same page once it exists.
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
Steps 1–4 shipped. The time-range half was deliberately deferred until the
checkpoint timeline existed — **2.1 has now shipped** (`components/video/
CheckpointTimeline.tsx` is generic on purpose, built with this picker in
mind), so the time-range half is unblocked; still not built. Only the topic
hint has shipped so far.

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

### 7.6 · Extract generation enums to an SDK-free leaf module ✅

**Done** — `5d501ae`, now `lib/ai/generationOptions.ts`.

Low-severity review finding. The generation option enums (`difficulty`,
`optionsPerQuestion`, `questionType`) live alongside SDK-importing code, which
forced test mocks to pull in more than they need.

### 7.7 · Pin clone independence with a test ✅

**Done** — `089d5d2`, both directions.

Twelve integration tests cover cloning, but **none assert that editing a clone
leaves the source unchanged** — the property teachers actually rely on. Add it
in both directions. See [`open-questions.md` §2](open-questions.md).

### 7.9 · `videos.title` / `duration_seconds` can stay null forever ✅

**Done** — `1e5b0f8` + migration 125, applied to the linked project. Note it repairs a
gap on a LATER quiz for the same video; it does not make the first fetch succeed,
so `duration_seconds` still arrives null while Epic 0 is unresolved.

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
| 8.2 | ~~Delete four merged remote branches.~~ **Done** — all four gone. Two new ones to retire: `fix/transcript-diagnostics` (superseded — ido merged it into `fix/transcript-fetch-diagnostics`) and any branch left behind by PR #63. |
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

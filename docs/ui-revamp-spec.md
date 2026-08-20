# OrtTube UI revamp — implementation spec

Refined from the product owner's review notes. Each numbered section is owned by
exactly one agent; the "Owns" list is that agent's write boundary. Everything is
UI/UX work on top of the existing API + RPC layer unless a section explicitly
calls for a new RPC.

## Ground rules (all agents)

1. **Design system.** The app is RTL Hebrew, light-only, glassmorphism. Reuse the
   tokens in `app/globals.css` and the primitives in `components/ui/`. Do not
   introduce a second styling approach, a dark theme, or emoji (the product uses
   stroke icons only — `components/ui/Icon.tsx`). For visual judgement calls you
   may load the `typeui-design-system` skill, which is where the current tokens
   came from.
2. **Architecture stays.** HTTP route handler → `@/lib/*` wrapper → `SECURITY
   DEFINER` RPC → tables. Business rules live in the database. Do not move
   ownership/tenancy/grading/reveal-gate logic into TypeScript.
3. **Next.js.** This repo tracks a Next version whose conventions may differ from
   what you remember. Read the relevant guide under `node_modules/next/dist/docs/`
   before writing routing/data-fetching code (see `AGENTS.md`).
4. **New migrations.** Only inside your reserved number range (below). Never edit
   an existing migration. The local stack is running; apply your migration with
   `supabase migration up` (or `supabase db reset` if you must) — never touch the
   hosted project, never run `supabase db push`, and do **not** run
   `npm run gen:types` (it reads the remote schema and would clobber a shared
   file). New RPCs return `jsonb` and are typed by hand in `@/lib`, exactly like
   `lib/analytics.ts` does today, so `lib/supabase/types.ts` needs no change.
5. **Verification before you report done** — all three, from the repo root:
   - `npx tsc --noEmit`
   - `npm run lint`
   - targeted vitest only: `npx vitest run <the test files your change touches>`.
     **Do not run the whole suite** (`npm test`).
   If you add a test, use the actor DSL in `test/helpers/testbed/`.
6. **Git.** Do not commit, branch, stash, or revert. Leave your work in the
   working tree; the orchestrator handles version control.
7. **Staying inside the lines.** If a change you need lands in another section's
   files, do not edit them — implement your side against the shared primitive and
   report the cross-boundary need in your final summary.
8. **Report** at the end: what you changed, what you verified (with command
   output status), and anything you deliberately left out.

### Reserved migration ranges

| Section | Range |
| --- | --- |
| 0 Foundation | 139 |
| 3 Analytics | 140–149 |
| 4 Classes | 150–159 |
| 5 Quizzes | 160–169 |
| 6 Student | 170–179 |

### Cross-cutting requirements (each agent applies these inside its own section)

- **Paging.** Every list/table/grid that can grow unbounded (rosters, quiz lists,
  assignment lists, analytics tables, tutor-question logs, student feed) must be
  paged — offset paging is acceptable, cursor paging where the underlying RPC
  already orders by a stable key. Use the shared paging primitive from Section 0.
  If the backing RPC returns everything at once, extend it (in your migration
  range) with `p_limit` / `p_offset` and a total count rather than slicing in the
  browser.
- **Icon-only actions.** Text buttons for obvious actions (delete, edit, assign,
  unassign, close, send, clear filters, back) become icon buttons with an
  accessible label and a hover tooltip. Use the shared `IconButton` from
  Section 0. Destructive icon actions keep their confirmation dialog.
- **Back navigation.** The current "go back to previous page" links are poor UX.
  Replace them with the shared back affordance from Section 0 — one consistent
  component, same placement on every screen (inline-start of the page header),
  labelled by the destination rather than "חזרה".

---

## Section 0 — Shared foundation (must land before Sections 1–6 start)

**Owns:** `components/ui/Icon.tsx`, `components/ui/IconButton.tsx` (new),
`components/ui/Tooltip.tsx`, `components/ui/BackLink.tsx` (new),
`components/ui/Pager.tsx` + `components/ui/usePagedList.ts` (new),
`components/ui/PasswordField.tsx`.

1. **Icon set.** `Icon.tsx` is the one file every section needs; grow it once,
   here, so nobody else has to. Add at minimum: `eye`, `eyeOff`, `logout` (door),
   `trash`, `edit` (pencil), `plus`, `send`, `filterOff` (clear filters),
   `chevronRight`, `chevronLeft`, `chevronUp`, `arrowRight`, `calendar`, `video`,
   `student`, `quiz`, `download`, `refresh`, `info`, `warning`, `link`,
   `collapse`/`expand`. Keep the existing stroke style (1.9px, 24×24 viewBox) and
   the filled-glyph exception list. Do not remove existing names.
2. **`IconButton`.** Icon-only button: required `label` (rendered as
   `aria-label` and as the hover/focus tooltip via the existing `Tooltip`),
   `variant` for neutral / brand / danger, sizes, disabled + busy states. This is
   the component the cross-cutting "buttons should be icons" rule leans on.
3. **`BackLink`.** One consistent back affordance: a chevron icon plus the
   destination name (e.g. "כל הכיתות", "החידונים שלי"), styled as a quiet inline
   control that sits at the inline-start of a page header — not a full-width
   button, not "חזרה לדף הקודם", never `router.back()` (browser-history back is
   what makes the current UX unpredictable). It takes an explicit `href` and
   `label`.
4. **Paging primitive.** `Pager` (page-size aware, RTL-correct
   previous/next + range readout, disabled edges, `aria-label`s) and a small
   `usePagedList` client hook that owns `page`/`pageSize` state and exposes
   `slice`/`onPageChange`, plus a variant that works against a server RPC that
   takes `p_limit`/`p_offset` and returns a total. Document with a short usage
   comment; Sections 3–6 consume it.
5. **`PasswordField`.** Replace the הצג / הסתר text toggle with an eye /
   eye-with-slash icon button (the conventional pattern), keeping the current
   accessible naming and focus behaviour.

Keep every new primitive minimal, typed, and consistent with the existing ones.

---

## Section 1 — Login and landing

**Owns:** `app/page.tsx`, `app/(auth)/**`, `app/api/auth/sign-up-student/route.ts`
(only if it becomes unreferenced), tests covering those.

1. **Logo/text ratio** on the landing screen is wrong: make the OrtTube lockup
   (mark + wordmark) noticeably larger and the supporting text smaller.
2. **Delete the descriptive paragraph** that begins
   `מורים בונים (או מייצרים ב-AI) שאלות המעוגנות לרגעים בסרטון…`.
3. **Remove sign-up entirely.** The school provisions accounts; the product has
   login only. Delete the `/sign-up` route and its form, remove every link to it,
   and delete the sign-up API route + any tests that exist solely for it if
   nothing else references them. Do not touch the invite RPCs or the database.
4. **Remove the CTA** `תלמיד/ה שהמורה הוסיף/ה לכיתה? יצירת חשבון`.
5. **Password reveal** now comes from the shared `PasswordField` (Section 0) —
   the eye icon, not הצג/הסתר text.
6. **Remove the line** `מורים ותלמידים מתחברים באותו מקום.` from the sign-in card.
7. **Redesign what remains.** With the paragraph, the second CTA and the sign-up
   path gone, the landing + sign-in screens are near-empty. Rebalance them into
   one deliberate, good-looking entry screen (consider folding the landing and
   the sign-in card together so a signed-out visitor lands directly on a login
   screen rather than a marketing page with one button). Follow the glass token
   system.

---

## Section 2 — Teacher shell, settings, overview (סקירה)

**Owns:** `components/shell/**`, `app/(teacher)/layout.tsx`,
`app/(teacher)/dashboard/page.tsx`, `components/teacher/overview/**`,
`app/(teacher)/dashboard/settings/page.tsx`,
`components/teacher/library/SettingsForm.tsx`, `components/teacher/StatTile.tsx`.

1. **Collapsible sidebar.** The right-hand sidebar collapses to an icon rail and
   expands back, with the state persisted across navigations (and reloads) and a
   keyboard-accessible toggle. Collapsed mode keeps icons + tooltips; the mobile
   drawer behaviour stays.
2. **Sign-out moves into the sidebar**, pinned to its bottom, as a door icon (+
   label when expanded) instead of living in the topbar.
3. **Settings:** delete the helper sentence
   `קובע את השפה שבה יוצגו לך שאלות החידון. ללא בחירה, נעשה שימוש בשפת הכיתה.`
4. **Overview (סקירה) is the teacher homepage — rebuild it as one:**
   - Keep: classes, students, count of completed quizzes, count of open quizzes.
     **Remove the average-grade tile**, and remove average grade from the class
     card too.
   - The stat cards adopt the same visual language as the quiz cards used in
     "My quizzes" (Section 5 owns that card; match its look — if it changes under
     you, match the version in the tree at the end).
   - The quizzes strip becomes a **single horizontally scrollable row** (RTL
     scroll, snap points, keyboard reachable) instead of a wrapping grid.
   - Add a **welcoming, engaging header** — this is the landing screen after
     login (greeting by name, time-of-day aware, something with a bit of life to
     it, without becoming noisy).
   - Above "החידונים הפעילים שלי", add a **"recently finished quizzes"** row —
     quizzes whose window closed in roughly the last week. Derive the window from
     the existing allocation lifecycle data (`lib/lifecycle.ts`,
     `lib/allocationState.ts`); make the lookback a named constant.

---

## Section 3 — Teacher analytics (largest section)

**Owns:** `app/(teacher)/dashboard/analytics/**`,
`app/(teacher)/dashboard/classes/[id]/analytics/**`,
`components/teacher/analytics/**`, `components/teacher/RosterTable.tsx`,
`components/teacher/TopicClusters.tsx` (to be deleted),
`lib/analytics.ts`, `lib/analyticsTopics.ts`, `lib/analyticsProgress.ts`,
`app/api/analytics/**`, migrations 140–149.

Today analytics is class-first: pick a class, see one class page. Replace that
with a **search-driven analytics hub**.

1. **Analytics home.** A search bar plus a scope selector — student / class
   (מקצוע-level entity) / quiz. Typing searches within the chosen scope over the
   teacher's own entities (their classes, the students in them, their quizzes);
   picking a result renders that entity's analytics view. Results must be paged
   and keyboard navigable, and the empty/loading/error states must be real
   states, not a blank screen. The selected entity should be reflected in the URL
   so a view is linkable and refresh-safe.
2. **Class view.** Header stats: number of students, number of open quizzes,
   number of finished quizzes.
   - Per-quiz table as today, each row linking to that quiz's analytics page.
   - **Remove the ניסיונות column and the כיסוי כיתה metric.** Keep average
     grade. Keep השלמות but render it as a fraction of the class size
     (`12/28`), not a bare percentage.
   - Per-student table as today, each row linking to that student's analytics
     view. **Replace the one-column-per-quiz layout** (unbounded width) with a
     single quiz-picker dropdown column: the teacher chooses a quiz and the
     column shows that quiz's result per student.
   - Add a **charts area** that holds several charts in a horizontally scrollable
     carousel with arrow controls: average grade per quiz, and other views you
     judge useful (score distribution, completion over time, per-question
     difficulty). Use the `dataviz` skill for chart design; charts must be
     legible in this light glass theme and readable RTL.
   - **Delete the "נושאים שנשאלו" feature entirely** — the UI, the topic
     clustering plumbing behind it that nothing else uses
     (`components/teacher/TopicClusters.tsx`, `lib/analyticsTopics.ts`,
     `lib/ai/clusterQuestions.ts`, `app/api/analytics/topics/`), and its tests.
     Grep for references before deleting; leave the AI helpers that other
     features share.
3. **Student view (new).** Identity/details for the student, the same class of
   charts (their grade trend, per-quiz results, comparison against the class
   average), whatever else you judge genuinely useful, and **the questions they
   asked the AI tutor**, filterable by quiz. `tutor_prompts_in_scope` (migration
   122) and `student_quiz_progress` (121) are the starting points — a student is
   currently reachable only per class, so a cross-class student view likely needs
   a new RPC in your migration range, teacher-scoped and school-scoped exactly
   like the existing analytics RPCs (`SECURITY DEFINER`, owner assertion,
   `revoke`/`grant` at the end).
4. **Quiz view.** Quiz details, relevant charts, **how many classes it is
   assigned to**, the tutor questions asked while taking it, and the
   **most-often-wrong questions**. Add an **"analyse with AI"** action over the
   most-asked tutor questions that summarises what students are struggling with —
   route it through the existing Anthropic integration in `lib/ai/` and the
   established error envelope, streaming if that matches the existing tutor
   pattern.
5. Any table you build here is paged (Section 0 primitive), and each analytics
   page gets the shared `BackLink`.

Coordinate nothing with other sections: other pages link **into** these routes,
so keep the route shapes stable or update the links you own.

---

## Section 4 — Teacher classes

**Owns:** `app/(teacher)/dashboard/classes/page.tsx`,
`app/(teacher)/dashboard/classes/[id]/page.tsx` (not the `analytics/` subroute),
`components/teacher/classes/**`, `lib/classes.ts` (read paths for these screens),
`app/api/classes/**` where required, migrations 150–159.

Inside a specific class:

1. **Roster:** drop the `צורף בתאריך` column.
2. **Remove roster mutation entirely** — no "הוספת תלמיד", no "הסרת תלמיד", and
   no delete-class action. Teachers do not manage membership; the school does.
   Remove the UI and any now-unreferenced client wrappers, but **leave the RPCs,
   API routes, and their tests intact** — they remain the school/admin path.
3. **Roster is searchable and paged**, and clicking a student navigates to that
   student's analytics view (Section 3's student route). Ask Section 3's route
   shape from the spec above rather than inventing one: link to the analytics hub
   with the student selected.
4. **Assigned-quiz list:** searchable and filterable by all / done / active,
   paged.
5. **Actions become icons.** `ביטול הקצאה`, `סיום שאלון` and friends turn into
   `IconButton`s with hover tooltips explaining them. Add an **edit icon** that
   opens the same editing affordance the הקצאות section already provides.
6. **Remove the `פעיל` tag and the `נסיונות` tag** from the rows/cards, and
   remove the row-level edit and delete actions that are being retired (the edit
   icon in point 5 replaces them).
7. **Fix the lifecycle presentation.** The active-quiz card's "time left" display
   and the finished-quiz `עד 26.8` label are both poor. Design a clear, compact
   status treatment: an unambiguous state chip plus a human-readable deadline
   ("נסגר בעוד 3 ימים", "הסתיים ב-26.8"), consistent across active and finished.
   `components/teacher/scheduleFormat.ts` is the formatting seam.
8. **Section styling:** completed and assigned sections read green and red
   respectively; the `מוסרים`/removed group is not a titled section at all —
   render those rows at reduced opacity, with **no analytics button**.

---

## Section 5 — Teacher quizzes (library, new quiz, editor)

**Owns:** `app/(teacher)/dashboard/quizzes/**`, `components/teacher/QuizCard.tsx`,
`components/teacher/library/QuizLibrary.tsx`,
`components/teacher/library/QuizPreviewModal.tsx`,
`components/teacher/editor/**`, `lib/libraryFilters.ts`, `lib/quizAuthor.ts`,
migrations 160–169.

**Library ("החידונים שלי"):**

1. Remove the "filter by number of questions" control.
2. Add a visibility filter: private / shared / all.
3. The quiz card is over-packed. Redesign it: a clear hierarchy (title, video
   thumbnail, the one or two facts that matter), the rest on hover or in the
   preview modal. This card's look is the reference for Section 2's overview
   cards, so make it a well-defined component.
4. The library list is paged.

**New quiz (`/dashboard/quizzes/new`):**

5. The YouTube-link hint is ugly and is left-aligned while sitting in an RTL
   form even though its content is English — fix both the styling and the
   direction handling (the URL input itself should be `dir="ltr"` with
   inline-start alignment, its hint should read naturally in the layout).
6. Redesign the whole page for a better flow — it is the first thing a teacher
   does.
7. **Quiz title is required**, not optional: enforce it in the form and surface
   the validation clearly. Do not weaken the server contract; if the RPC allows a
   null title, the client requirement is a form-level rule.

**Quiz editor (`/dashboard/quizzes/[id]/edit`):**

8. Drop the word `נראות`; show the private/shared control on its own.
9. Replace the `מחיקת הסרטון` text action with a trash icon, placed sensibly
   (next to the video, not buried in the settings box).
10. Move `משך החידון` out of the first box and give it a better presentation.
11. Remove the language and "transcript loaded" tags.
12. Remove the link to the video and **embed the actual video player** above the
    הקצאות section.
13. **Page order: title box → video → questions → הקצאות.**
14. `הקצאה לכיתות` becomes a plus `IconButton`.
15. Assignment and question lists are paged if they can grow.

---

## Section 6 — Student experience

**Owns:** `app/(student)/**`, `components/student/**`, `components/video/**`,
`lib/studentFeedFilters.ts`, `lib/tutor.ts` (client-facing formatting only),
migrations 170–179.

**Feed:**

1. `החידונים שהוקצו לכיתות שלך` → `החידונים שהוקצו לך`.
2. **Terminology: כיתה → מקצוע** everywhere in the student-facing UI (labels,
   placeholders, filter names, empty states). **Do not rename database objects**
   — the `classes` table rename is a separate, orchestrated task; this section
   changes copy only.
3. `נקה מסננים` becomes an icon button (`filterOff`) with a tooltip.
4. Scores are shown as a **grade out of 100**, not a percentage — feed, results
   screen, and review. Keep the underlying data unchanged; this is presentation.
5. The feed is paged.

**Quiz player:**

6. **Add a back button** when a video is open, using the shared `BackLink`,
   matching the teacher-side placement.
7. **Checkpoint markers are mis-positioned:** a question at 0:53 of a 15-minute
   video renders mid-bar. Position each marker at
   `question.videoTime / videoDuration` along the timeline, and make the bar
   itself a YouTube-style progress fill that tracks playback. `components/video/
   CheckpointTimeline.tsx` and `components/video/VideoStage.tsx` are the files.
   Guard against an unknown/zero duration.
8. Remove the `השאלה הבאה` element.
9. Improve the `x/y שאלות` counter above the video — it currently looks tacked
   on; make it a designed progress indicator.
10. `שאל את המורה` → `שאל את OrtAI` (every occurrence).

**Ask-AI panel (`components/student/AskAI.tsx`):**

11. The `שליחה` button becomes a send icon button.
12. Loading state: replace the current effect with a **three-dot typing bubble**
    in the assistant's message slot, then reveal the streamed answer smoothly
    (progressive, non-janky — animate opacity/position of settled chunks rather
    than re-rendering the whole answer on every token, and don't fight the
    browser's scroll).
13. **Markdown emphasis is rendered literally** — `**bold**` shows its asterisks.
    Render the assistant's basic markdown (bold, italics, inline code, lists,
    line breaks) safely: no `dangerouslySetInnerHTML` with unsanitised model
    output — either a tiny purpose-built renderer for that subset or an existing
    dependency already in `package.json`.

---

## Follow-up (not in this pass)

Renaming the `classes` table (and every RPC, policy, wrapper, test and doc that
names it) to the "מקצוע"/subject vocabulary is a repo-wide refactor that touches
every file the sections above are editing. It runs after this pass, as its own
task.

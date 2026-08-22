# OrtTube UI fixes — round 2

Refined from the product owner's second review pass (after the UI revamp landed
in `ed8ab68`). Each numbered section is owned by exactly one agent; the "Owns"
list is that agent's write boundary. Everything here is UI/UX work on top of the
existing API + RPC layer unless a section explicitly calls for a new RPC.

## Ground rules (all agents)

1. **Design system.** RTL Hebrew, light-only, glassmorphism. Reuse the tokens in
   `app/globals.css` and the primitives in `components/ui/`. No second styling
   approach, no dark theme, no emoji — stroke icons only
   (`components/ui/Icon.tsx`). Match the surrounding code's comment density and
   idiom: comments describe the current design and intent, never history.
2. **Architecture stays.** HTTP route handler → `@/lib/*` wrapper → `SECURITY
   DEFINER` RPC → tables. Business rules live in the database.
3. **Next.js.** This repo tracks a Next version whose conventions may differ from
   what you remember. Read the relevant guide under `node_modules/next/dist/docs/`
   before writing routing/data-fetching code (see `AGENTS.md`).
4. **Migrations.** Only inside your reserved number range (below). Never edit an
   existing migration. Apply with `supabase migration up` against the **local**
   stack only — never `supabase db push`, and do **not** run `npm run gen:types`
   (it reads the remote schema and would clobber a shared file). New RPCs return
   `jsonb` and are typed by hand in `@/lib`, exactly like `lib/analytics.ts`.
5. **Verification before you report done** — all three, from the repo root:
   - `npx tsc --noEmit`
   - `npm run lint`
   - targeted vitest only: `npx vitest run <the test files your change touches>`.
     **Never run the whole suite** (`npm test`) and **never run E2E / smoke tests**
     (`npm run smoke`, or anything that drives a live app or browser).
6. **Git.** Do not commit, branch, stash, or revert. Leave your work in the
   working tree; the orchestrator handles version control.
7. **Staying inside the lines.** If a change you need lands in another section's
   files, do not edit them — implement your side against the shared primitive and
   report the cross-boundary need in your final summary. In particular:
   **Sections 2–6 must not touch `components/shell/**`, `components/ui/**`, or
   `app/globals.css`** — those belong to Section 1. Tooltip placement, focus
   rings, the pager readout and the back affordance are Section 1's job
   everywhere in the app; do not patch them locally.
8. **Back links.** Nobody outside Sections 1 and 7 edits back navigation. Section 1
   builds the mechanism, Section 7 applies it across every page.
9. **Report** at the end: what you changed, what you verified (with command
   output status), and anything you deliberately left out.

### Reserved migration ranges

| Section | Range |
| --- | --- |
| 4 My quizzes / editor | 146–149 |
| 6 Student | 150–159 |

---

### Decisions the product owner has settled

- **Sidebar:** the rail is permanently icon-width in the layout; hover floats it
  open **above** the page content. The main column never reflows. The collapse
  toggle and its cookie are deleted.
- **Back navigation:** an explicit `?from=` key resolved through a registry to a
  named destination. Not `router.back()`.
- **Ask-AI:** on wide screens the video column shrinks to make room for a
  ~380px chat column beside it (no overlay, no scrim); below ~1100px it falls
  back to a sheet.

## Section 1 — Shared chrome and primitives

**Owns:** `components/shell/**`, `components/ui/Tooltip.tsx`,
`components/ui/Pager.tsx`, `components/ui/BackLink.tsx`,
`components/ui/Select.tsx`, `components/ui/Field.tsx`,
`components/ui/MultiSelectDropdown.tsx`, `components/ui/PasswordField.tsx`,
`app/globals.css`, `app/(teacher)/layout.tsx`, `app/(student)/layout.tsx`
(only for the sidebar wiring), plus tests covering those.

1. **Sidebar opens on hover.** Remove the collapse/expand icon button and the
   cookie-backed collapsed state (`sidebarCollapse.ts` and its server reads in
   the two layouts go away). From `md` up the rail is *always* the narrow
   icon-only version in the page layout; pointer-hover (and keyboard focus
   inside it) expands it to its full labelled width as a **floating overlay
   above the page content** — the main column never reflows. Keep the expanded
   state while focus is inside the rail so a keyboard user can tab through it.
   The mobile drawer (hamburger + scrim) is unchanged.
2. **Sidebar scrolling.** The rail must not need page scroll to reach sign-out:
   it is a full-viewport-height sticky/fixed column with its own independent
   scroll container, and it only scrolls when its own content genuinely
   overflows. Scrolling the page must never move the rail, and scrolling inside
   the rail must never scroll the page.
3. **Tooltip correctness.** Audit `Tooltip` for the two classes of bug the
   product owner reported:
   - *Placement/truncation.* Labels appear clipped, truncated or oddly offset —
     especially near a viewport edge, inside a `.glass` card (which sets
     `overflow: hidden`) and at the end of a row. Make the bubble escape its
     clipping ancestor and stay inside the viewport: portal it to `<body>` with
     fixed viewport coordinates read off the trigger's rect, flipping
     top/bottom and clamping horizontally, the way
     `MultiSelectDropdown` already does for its panel. Never truncate the label.
   - *Sticky tooltip.* Opening a modal, toast or confirm dialog over a hovered
     trigger means `mouseleave` never fires, so the tooltip stays visible after
     the dialog is dismissed (reproduce: trash icon in "החידונים שלי" → cancel
     the confirmation). Close on pointer-down on the trigger, on `Escape`, on
     window blur, and whenever the trigger no longer matches `:hover` — so the
     bubble cannot outlive the hover that created it. Fix it once in `Tooltip`
     (and `IconButton`/`IconLink` if they need it); do not paper over it at call
     sites.
4. **Focus rings.** Clicking a dropdown, a text input or the minutes field
   paints a green outline/ring around it. Drop the pointer-triggered ring: keep
   an accessible indicator for *keyboard* focus only (`:focus-visible`), and
   make it quiet — no brand-green box around a control the user merely clicked.
   Sweep every input primitive (`Select`, `Field`, `PasswordField`,
   `MultiSelectDropdown`, the `Pager` page-size `select`, and the raw
   `focus:ring-*` / `focus:border-[var(--brand)]` usages in `app/globals.css`)
   so the treatment is consistent.
5. **Pager readout.** Replace the range readout ("מציג 1–12 מתוך 13") with a
   page readout — "עמוד 1 מתוך 2". Keep the bidi isolation, the `tabular-nums`,
   the `aria-live` and the RTL-correct previous/next. `total` may become unused
   in the readout; keep or drop the prop as the type checker prefers, but update
   every call site you own and the component's usage comment.
6. **`MultiSelectDropdown` width.** The panel is a fixed 224px, which makes the
   "כיתה משויכת" dropdown far wider than its content. Size the panel to its
   longest option label plus a little padding, clamped to a sensible min/max,
   instead of a hard-coded constant. Keep the portal/positioning behaviour.
7. **Contextual back mechanism.** Build the primitive Section 7 will apply:
   `BackLink` keeps taking an explicit destination, but callers can now hand it
   the place the user actually came from. Implement it as an **explicit
   `?from=<key>` search param** — a small registry (new module, e.g.
   `components/ui/backTarget.ts`) mapping a short key to `{ href, label }`, a
   helper to append the key to an outgoing link, and a `BackLink` that resolves
   `from` when present and falls back to its own `href`/`label` when absent.
   Deliberately **not** `router.back()`: browser-history back is what made the
   old links unpredictable, and it cannot label its destination. Document the
   registry with a usage comment; Section 7 populates the call sites.

---

## Section 2 — Login screen

**Owns:** `app/(auth)/**`, tests covering it.

1. The three capability lines under the lockup are shared by teachers *and*
   students, but "תמונת מצב על הכיתה" only speaks to teachers. Keep three
   lines: replace that one with something true for both roles, in the same terse
   register and with an existing `IconName`. (The other two —
   "שאלות מעוגנות לרגעי הסרטון", "OrtAI עונה תוך כדי הצפייה" — stay.)

---

## Section 3 — Teacher home

**Owns:** `app/(teacher)/dashboard/page.tsx`,
`components/teacher/overview/**`, `components/teacher/StatTile.tsx`, and tests
covering those.

1. **The "+" FAB.** Hovering it should read "חידון חדש" rather than whatever it
   says now.
2. **Clickable KPI tiles.** Only "כיתות" navigates today. "חידונים פעילים" and
   "חידונים שהסתיימו" must link to "החידונים שלי" pre-filtered to the matching
   status. The URL contract with Section 4 is fixed:
   `/dashboard/quizzes?status=active` and `/dashboard/quizzes?status=finished`.
   Section 4 owns reading that param; you own producing the links. Keep the
   tiles' non-interactive look for tiles that don't navigate.
3. **Scroll rows.** Remove the left/right arrow affordance from the horizontally
   scrollable quiz rows (`ScrollRow`) — plain scroll (touch, trackpad, wheel,
   keyboard) with no overlay controls or gradient "bar" hint.
4. **Recently-ended date.** The closed-at date on a finished-quiz card is plain
   text and reads poorly. Give it a proper treatment — an icon + a clearer
   relative/absolute phrasing, styled as a quiet meta line rather than a
   sentence. Keep the school time zone (`SCHOOL_TIME_ZONE`) and the existing
   `formatShortDate`/`Intl` approach.
5. **Class card stats.** Each class card must show **תלמידים**, **חידונים
   פעילים**, **חידונים שהסתיימו** instead of today's three figures. Derive them
   the same way the KPI row does (`allocationState` per allocation — live or
   scheduled counts as active, `done` as finished); extend
   `components/teacher/overview/aggregate.ts` (`ClassSummary`, `summarizeClass`)
   rather than computing in the component, and update its unit tests.
6. **Class card affordances.** Remove the "צפייה באנליטיקה" button. Instead: the
   card body navigates to the class, and the analytics glyph on the card is
   itself the link to that class's analytics. Hovering the glyph must show a
   distinct circular hover surface so it reads as a separate target from the
   card. Use `IconLink`; make sure the nested-interactive markup is valid (no
   `<a>` inside `<a>`).

---

## Section 4 — My quizzes, new quiz, edit quiz

**Owns:** `components/teacher/library/**`, `components/teacher/QuizCard.tsx`,
`components/teacher/editor/**`, `lib/libraryFilters.ts`, `lib/allocations.ts`,
`app/(teacher)/dashboard/quizzes/**`, migrations 146–149, and tests covering
those.

### My quizzes

1. **"כיתה משויכת" dropdown width.** The dropdown is far too wide. Section 1
   makes `MultiSelectDropdown` size itself to its longest option; your job is to
   consume that (drop any local width overrides) and check the result on a real
   class list. Do not edit `MultiSelectDropdown` yourself.
2. **"נראות" becomes a dropdown.** Replace the three-option `SegmentedToggle`
   with a single dropdown control, consistent with the other filters in the bar.
3. **Video hover effect.** Hovering a quiz card's video thumbnail currently
   darkens it. Replace the darkening with a nicer effect in keeping with the
   design system (e.g. a subtle scale/lift plus a play affordance) — no dimming
   overlay.
4. **Allocation tag line.** A card says "זמין בכיתה ז׳1" / "זמין ב-2 כיתות" but
   drops the scheduled classes when there are also live ones. It must convey
   *both*: what it is available in and what it is scheduled for. This also gives
   you what item 5 needs.
5. **Status filter + deep link.** Add a status axis to the "שלי" tab —
   all / active / finished — with the same semantics as the home KPI tiles
   ("active" = at least one live or scheduled class; "finished" = no live or
   scheduled class but at least one closed window; drafts are neither). The tags
   RPC (`list_my_quiz_allocation_tags`) only returns `live` and `scheduled`
   today, so extend it with a `closed` bucket in a new migration in your range,
   and mirror the shape in `lib/allocations.ts` (`QuizAllocationTags`). The
   filter's initial value comes from the `status` search param produced by
   Section 3: `?status=active` and `?status=finished` (anything else = all).
   Read it the way this Next version prescribes for a client-side filter on a
   server-rendered page.

### New quiz

6. Remove "הערכה מסרון" — leave only the option to limit the time.
7. Remove the explanatory text beneath the YouTube-link input.
8. The YouTube-link example hint looks bad. Redesign it as a quiet, well-formed
   hint (LTR-isolated URL sample, correct alignment inside an RTL form) rather
   than the current stray line.

### Edit quiz

9. Remove "הערכה מסרון" here too — only the time limit remains.
10. "משך החידון" is its own card and eats far too much vertical space for one
    number. Fold it into a more reasonable home (alongside the other quiz-level
    settings), keeping the same behaviour and validation.

---

## Section 5 — Classes

**Owns:** `components/teacher/classes/**`,
`app/(teacher)/dashboard/classes/**` (excluding anything Section 3 or 7 owns),
`components/teacher/EndQuizConfirmModal.tsx`, and tests covering those.

1. **Status colours are inverted.** "פעילים" renders red and "הסתיימו" green.
   Swap them: active is the success/green tone, finished is the neutral/closed
   tone. Check every place these two states are coloured (tabs, badges, pills)
   so the fix is not partial, and use the semantic tokens rather than raw
   colours.
2. **Add a "מוסתרים" section** in gray, alongside the existing status sections.
   Determine from the existing data model and RPCs what "hidden" already means
   for a class quiz allocation (draft / unpublished / closed-and-hidden) and
   bucket accordingly — do **not** invent a new column or migration. If no
   existing state maps cleanly onto "hidden", stop and report that in your
   summary instead of guessing.

---

## Section 6 — Student

**Owns:** `app/(student)/**`, `components/student/**`, `components/video/**`,
`lib/studentFeedFilters.ts`, migrations 150–159, and tests covering those.

1. **Checkpoint timeline.** On the question bar under the video, hovering a
   question marker shows that question's timestamp, and clicking it seeks the
   video to that point. Respect the existing gate logic in `components/video/`
   — a marker the student may not jump to must not become a seek control.
2. **Completed quiz opens straight to results.** Today, tapping a completed
   quiz lands on a thumbnail page with a "show results" button. Remove that
   interstitial: a completed quiz goes directly to the results page, and the
   results page shows the video alongside the results (so the student can
   re-watch while reviewing). Delete the now-dead intermediate UI rather than
   leaving it unreachable.
3. **Completed / to-do state UI.** The finished state is a plain "הסתיים
   ב-28.08" line — boring and cramped. Design a proper treatment for both the
   completed state and the still-to-assign state (badge or status block with
   icon, grade, date, and the right emphasis), consistent with the design
   system.
4. **Deadline countdown.** Opening a quiz the student still has to submit must
   show how much time is left until the deadline (`available_until`), not just
   the date. Handle "no deadline" and "due today" gracefully.
5. **Ask-AI send button.** The arrow glyph is off-centre inside its circle.
6. **Ask-AI scrollbar.** The chat's scroll must work without a visible
   scrollbar down the side.
7. **Ask-AI placement.** The panel currently floats over the video and dims the
   screen. With the sidebar now an icon rail (Section 1), there is room: open
   the panel *beside* the video — no overlap, no opacity scrim — with the video
   column shrinking to make space. Below the breakpoint where that doesn't fit,
   keep a sheet/overlay fallback. Coordinate with the quiz-page layout, not just
   the panel's own CSS.
8. **Student welcome component.** The student feed lacks the greeting header the
   teacher home has (`components/teacher/overview/WelcomeHeader.tsx`). Add the
   student equivalent — same shape and tone, student-relevant content (what's
   due next rather than class counts). Reuse the greeting/date helpers by
   importing them; do not duplicate them, and do not edit the teacher file. If
   they need to move to a shared module, report that instead.

---

## Section 7 — Contextual back navigation (runs after 1–6)

**Owns:** every `BackLink` call site and the outgoing links that feed it.

Using Section 1's `?from=` registry, make back links land where the user
actually came from. The motivating bug: the "+" on the teacher home creates a
quiz, and its back link goes to "החידונים שלי" instead of the home page. Apply
it wherever a page is reachable from more than one place, keeping the
destination-named label ("חזרה ל…" is still wrong; the label names the place).
Where a page has exactly one entry point, leave the static `href`.

# Class analytics: dashboard-grid redesign

**Scope:** the class analytics view only
(`components/teacher/analytics/ClassAnalyticsView.tsx` and its children,
reached at `/dashboard/analytics?scope=class&id=<uuid>`). Student and quiz
analytics views are untouched — they don't share `ClassCharts.tsx`, so nothing
here reaches them.

## Why

The teacher supplied a mockup of a class-analytics dashboard: a fixed grid of
stat cards, two charts, and two tables, all visible at once. The current
screen covers the same ground but as a swipeable chart carousel plus two
full-width table sections. This is a layout and chart-type change, not a new
feature — almost every number the mockup shows already exists in
`ClassAnalyticsOverview` / `ClassRosterProgress`.

## Decisions

1. **Metric row** — keep all four existing tiles (average score, finished
   quizzes, active quizzes, students in class) unchanged. Add one new hint:
   the active-quizzes tile's hint switches from "out of N assigned" to also
   surface a scheduled-count, e.g. "N assigned · M opening soon", using the
   existing `allocationState() === "scheduled"` classification — no backend
   change, the quizzes are already fetched.

2. **Dropped from the mockup:** the score trend ("+6% from previous period")
   and the attendance rate ("82%"). Neither is backed by real, well-defined
   data today — "previous period" has no clean definition for a class with
   irregular quiz cadence, and attendance isn't modeled at the class-roster
   level (no per-member activity timestamp is exposed by
   `class_roster_progress`). Not faked; left out.

3. **Charts become a fixed 2×2 grid of cards**, replacing the 4-slide
   carousel in `ClassCharts.tsx`. All four existing charts are kept — none are
   dropped just to match the mockup's 2-chart layout:
   - Average score by quiz (existing `ColumnChart`, unchanged)
   - **Grade distribution — new `DonutChart`**, replacing the bar-chart
     rendering of `score_distribution`. Reuses `ORDINAL_RAMP` (the existing
     validated 5-step blue ramp) for the five score bands, for consistency
     with the app's accessibility-validated chart palette — not the mockup's
     5-hue rainbow, which isn't a validated categorical palette on this
     surface.
   - Completion rate by quiz (existing `ColumnChart`, unchanged, promoted out
     of the carousel)
   - Completions over time (existing `LineChart`, unchanged)

   Each stays wrapped in `ChartCard` (title, hint, table-twin toggle) exactly
   as today; only the carousel/slide wrapper is removed in favor of a
   `grid grid-cols-1 gap-4 lg:grid-cols-2` layout.

4. **New: student-activity leaderboard.** A compact, non-paginated top-N
   (5) list of the class's most active students this — ranked by
   `quizzes_completed` (ties broken by `average_best_score`) — each row an
   `Avatar` (existing component, initials fallback), name, completed/assigned
   fraction, and average score. Read-only, no search/filter. Links through to
   the student's own analytics view like every other student row in this
   product. Data comes from `ClassRosterProgress.members`, already fetched by
   `ClassAnalyticsView` for `RosterTable` — no new query.

   This is additive, not a replacement: the existing full `RosterTable`
   (searchable, paged, per-quiz picker) stays, full-width, below. The
   leaderboard answers "who's most active," which the full table doesn't
   surface at a glance; the full table answers "how is a specific student
   doing."

5. **Recent-quizzes table stays as-is.** The existing `ClassQuizTable`
   (searchable, paged, status badges, link-through) is kept full-width below
   the chart grid, unchanged. The mockup's condensed "recent units" preview
   (3 rows, no search, extra date columns) is not built — the existing table
   already does this job, and condensing it into a half-width preview widget
   would either duplicate it or lose its search/paging for no real gain.

## Layout (top to bottom)

1. `MetricRow` — 4 tiles (unchanged component, new hint text on one tile)
2. New 2×2 chart grid (replaces the carousel) — avg score, grade distribution
   (donut), completion rate, completions over time
3. New `StudentActivityLeaderboard` — top 5 most active students
4. `ClassQuizTable` — unchanged, full width
5. `RosterTable` — unchanged, full width

## New components

- `components/teacher/analytics/DonutChart.tsx` — SVG ring chart, one series,
  ordered categories, following the same conventions as `ColumnChart.tsx`
  (hover/focus readout via `ChartTooltip`, `formatValue`, `ariaLabel`,
  `BOX`/`CHROME` shared constants where they apply to a ring rather than an
  axis). Segment order and colors: `ORDINAL_RAMP`, band order low → high,
  matching how the existing bar-chart rendering already colors these bands.
- `components/teacher/analytics/StudentActivityLeaderboard.tsx` — takes
  `ClassRosterProgress`, renders the top 5 by completion count. No new data
  fetch: derived client-side (a `"use client"` component, like
  `RosterTable`) from the same prop `ClassAnalyticsView` already passes to
  `RosterTable`.

## Changed components

- `components/teacher/analytics/ClassCharts.tsx` — carousel → 2×2 grid;
  score-distribution slide becomes the donut chart.
- `components/teacher/analytics/ClassAnalyticsView.tsx` — inserts the
  leaderboard section between the chart grid and `ClassQuizTable`; passes the
  scheduled-quiz count into the active-quizzes tile's hint.

## Out of scope

- Student and quiz analytics views (still carousel-based, unchanged).
- Any backend/migration change (no new RPC fields; trend and attendance are
  dropped rather than added).
- A validated multi-hue categorical palette (would be required only if a
  future request insists on the mockup's rainbow donut).

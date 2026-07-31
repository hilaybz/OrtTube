# OrtTube frontend redesign — plan index

> Umbrella index for the phased frontend rebuild. Spec:
> [`../specs/2026-07-14-frontend-redesign-design.md`](../specs/2026-07-14-frontend-redesign-design.md).
> Each phase is its own executable plan producing working, testable software.

## Phase plans

| Phase | Plan file | Produces |
| --- | --- | --- |
| **P0 · Foundation** | `2026-07-14-frontend-p0-foundation.md` | Design tokens + glass system, primitives, both role shells + guards, auth (sign-in/sign-up/landing/sign-out), seed fixture, Playwright harness. |
| **P1 · Student loop** | `2026-07-14-frontend-p1-student.md` | Feed, player (checkpoints/submit/complete/resume), reveal-gated review, Ask-AI streaming. + backend read `list_my_attempts_for_quiz`. |
| **P2 · Teacher authoring** | `2026-07-14-frontend-p2-authoring.md` | Create/edit quiz, timeline editor, AI-generate, translate, publish/share, library + catalog + clone. + backend read `get_quiz_for_author`. |
| **P3 · Classes & delivery** | `2026-07-14-frontend-p3-classes.md` | Classes CRUD, roster/invites, assignment (tutor mode / max attempts), student management. |
| **P4 · Analytics & viz** | `2026-07-14-frontend-p4-analytics.md` | Overview KPIs, per-quiz/class/tutor analytics, SVG data-viz primitives. |
| **P5 · Polish** | `2026-07-14-frontend-p5-polish.md` | Motion, empty/loading/error passes, settings, responsive, a11y audit. |

## Spec-section → phase coverage

- §2 Visual system → **P0** (token layer, glass system, Rubik/RTL), applied by all.
- §3 Architecture (server reads via `@/lib`, client mutations via `/api`, guards, `await params`) → **P0**, upheld by all.
- §4 Auth + landing → **P0**. Student screens → **P1**. Teacher authoring → **P2**;
  classes → **P3**; analytics → **P4**; settings → **P0 shell + P5**.
- §5 Components: primitives → **P0**; player components → **P1**; data-viz → **P4**.
- §8 Phasing → this index. §10 Verification → per-phase (hybrid loop) in each plan.
- §11 Backend reads: `list_my_attempts_for_quiz` → **P1**; `get_quiz_for_author` → **P2**.

## Execution order

P0 → P1 → P2 → P3 → P4 → P5. Each plan ends green (build/lint/tests + Playwright
self-verify) and a visual checkpoint before the next begins.

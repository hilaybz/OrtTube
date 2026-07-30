# AI question-generation options — Phase 2 spec

**Date:** 2026-07-30
**Status:** Draft for review
**Owner:** idoshu
**Depends on:** Phase 1 (shipped) — count chooser modal (`GenerateModal` in
`components/teacher/editor/QuizEditor.tsx`) + free 1–20 count input.

## 1. Goal

Let a teacher shape AI generation beyond *how many* — **difficulty, question
type, options-per-question, coverage/focus, and duplicate-avoidance** — surfaced
in the existing generate chooser modal. Every UI option must mirror a capability
the generate route + prompt actually honor (no UI knob without a backend that
respects it).

## 2. Current state (grounded)

- **Route:** `app/api/quizzes/[id]/generate/route.ts` — owner-checks, warms the
  transcript via `getTranscript`, calls `generateQuizQuestions`, persists via
  `persistGeneratedQuestions`. Request body today: `{ count }` only, validated
  `1–20`. Error codes: `unauthorized/invalid_request/not_found/forbidden/
  transcript_unavailable/generation_failed`.
- **Generator:** `lib/ai/generate.ts` →
  `generateQuizQuestions(segments, count, baseLanguage)`. Hardcodes:
  - `OPTIONS_PER_QUESTION = 4`
  - `kind` chosen by the model per question ("single … for most; multi only when
    the content supports it")
  - placement "spread across the WHOLE video at natural topic boundaries"
  - model `claude-haiku-4-5-20251001`
  - `normalizeGeneratedQuestion` enforces the answer-key invariant (single =
    exactly one correct; multi ≥1) and caps options at `OPTIONS_PER_QUESTION`.
  - `buildTimestampedTranscript` builds the whole transcript (capped ~28k chars).
- **Placement/order:** `normalizeGeneratedQuestion` assigns
  `order_index = result.length` (0-based **within the batch**), independent of
  existing questions. `position_seconds` is snapped to a segment boundary.
- **UI:** `GenerateModal` — count input, "add / create" copy by `hasQuestions`.

## 3. The options

| Option | Values | Where it acts | Feasibility |
| --- | --- | --- | --- |
| **count** | 1–20 | route body (done) | ✅ shipped |
| **difficulty** | `easy` · `medium` · `hard` | prompt instruction | medium — prompt only |
| **question type** | `single-only` · `allow-multi` (default) · `multi-only` | prompt + `normalizeGeneratedQuestion` kind coercion | medium |
| **options per question** | 3 · 4 · 5 | prompt + parameterize `OPTIONS_PER_QUESTION` cap in normalize | medium |
| **focus / coverage** | whole video (default) · time range `[start,end]` · topic hint (free text) | slice `segments` before `buildTimestampedTranscript`, and/or inject topic into the prompt | higher — time-range couples to the checkpoint timeline |
| **avoid duplicates** | on when appending (`hasQuestions`) | pass existing prompts/positions into the prompt as "do not repeat" | medium — also fixes append correctness (§5) |

Deferred / optional: **cognitive level** (Bloom: recall→analysis) as a richer
alternative to a flat difficulty enum; **question style** (concise vs. scenario).
Recommend shipping a flat `difficulty` first — it is legible to teachers — and
revisiting Bloom levels only if needed.

## 4. API contract

`POST /api/quizzes/[id]/generate` body grows, **all new fields optional** (a
bare `{ count }` keeps working — backward compatible):

```jsonc
{
  "count": 5,                       // 1–20 (existing)
  "difficulty": "medium",           // "easy" | "medium" | "hard"
  "questionType": "allow-multi",    // "single-only" | "allow-multi" | "multi-only"
  "optionsPerQuestion": 4,          // 3 | 4 | 5
  "focus": {                        // optional; omit = whole video
    "startSeconds": 0,
    "endSeconds": 300,
    "topic": "free-text hint"
  }
}
```

Server validates/clamps every field and rejects out-of-range with
`invalid_request` (400) — same shape as the current `count` guard. Unknown enum
values → 400 (don't silently coerce). `focus` range clamped to the video
duration; `startSeconds < endSeconds` or reject.

## 5. Backend design

- **`generateQuizQuestions`** signature → an options object:
  `generateQuizQuestions(segments, { count, difficulty, questionType, optionsPerQuestion, focus, avoidQuestions }, baseLanguage)`.
  Keep the pure helpers (`snapToSegmentBoundary`, `normalizeGeneratedQuestion`)
  unit-testable.
- **Prompt** gains one constraint line per active option:
  - difficulty → a target-difficulty sentence.
  - questionType → constrain `kind` ("all single", "some multi allowed", "prefer
    multi") — the DB answer-key invariant still wins downstream.
  - optionsPerQuestion → replace the hardcoded "Exactly 4 options" line and the
    example block; thread the number into `normalizeGeneratedQuestion`'s cap
    (rename `OPTIONS_PER_QUESTION` → a param). **Keep the "split correct before
    trimming" ordering** so a variable cap never drops the answer key.
  - focus → **slice `segments` to `[startSeconds, endSeconds]` before
    `buildTimestampedTranscript`** (positions then naturally fall in range), and
    inject any topic hint into the instruction.
  - avoidQuestions → pass the existing base prompts (and rough positions) so the
    model doesn't restate them.
- **Model:** keep Haiku 4.5. If `difficulty=hard`/analysis questions come out
  weak in eval, consider escalating only that path to a stronger model — decide
  from eval, not upfront.

### Correctness items to fix alongside (surfaced while grounding this spec)

1. **Append order_index collision.** `normalizeGeneratedQuestion` numbers
   `order_index` from 0 per batch, so "add more" reuses 0..n-1 and collides with
   existing questions. Fix: offset generated `order_index` by the current max
   (compute in the route from the quiz's existing questions, or pass a base into
   the generator). The editor read sorts `order_index, position_seconds, id`, so
   today it degrades to position order — messy, not broken, but should be fixed
   with the "add more" work.
2. **Duplicate content on append.** Ties to `avoidQuestions` above — without it,
   a second batch can restate the first.

## 6. Frontend design

- Evolve `GenerateModal` (already the shell) to hold the new controls:
  - count (existing number input),
  - difficulty — `SegmentedToggle` (easy/medium/hard),
  - question type — `SegmentedToggle`,
  - options per question — small `SegmentedToggle` (3/4/5),
  - focus — collapsed "advanced" disclosure: whole-video (default) vs. a range;
    the range picker can reuse the checkpoint timeline once that exists, so
    **defer the range UI** and ship topic-hint + difficulty/type/options first.
- Defaults reproduce today's behavior (medium, allow-multi, 4 options, whole
  video) so an unchanged click behaves exactly as now.
- Keep the hero-vs-"add more" placement and the additive copy from Phase 1.

## 7. Invariants & validation

- The DB answer-key invariant (structural `is_correct`, single = exactly one
  correct) is enforced by `normalizeGeneratedQuestion` **and** the DB — the new
  options must not weaken it. `questionType=single-only` coerces multi→single by
  keeping the first correct (existing single path).
- All numeric/enum inputs clamped/validated server-side; UI ranges mirror the
  server bounds (the Phase-1 count lesson: never let the UI narrow what the
  backend supports, nor widen past it).

## 8. Testing

- **Unit:** route validation/clamping per field; `normalizeGeneratedQuestion`
  with a parameterized options cap (3/5) preserving the answer key;
  order_index-offset math for append.
- **Prompt eval:** a small fixture asserting the levers visibly move output —
  difficulty changes phrasing, `optionsPerQuestion` changes option counts,
  `single-only` yields no multi, `focus` keeps positions in range. Not just
  "returns something."
- Keep existing generate/authoring tests green.

## 9. Build order (each independently shippable)

1. **Append correctness** — order_index offset + `avoidQuestions` (cheap, fixes a
   real bug; no new UI).
2. **difficulty** — prompt + modal `SegmentedToggle`.
3. **optionsPerQuestion** — parameterize the cap + prompt + modal.
4. **questionType** — prompt + kind coercion + modal.
5. **focus** — topic hint first; time-range range-picker deferred until the
   checkpoint timeline exists.

## 10. Open decisions

1. Flat `difficulty` (easy/medium/hard) now vs. Bloom cognitive levels? →
   recommend flat first.
2. Time-range focus now, or defer until the visual checkpoint timeline lands? →
   recommend defer; ship topic-hint focus.
3. Escalate `hard` to a stronger model? → decide from eval, default no.

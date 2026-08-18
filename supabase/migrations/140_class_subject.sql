-- ============================================================
-- classes.subject — what the class studies.
--
-- A class is a group of students who learn ONE subject together, not a
-- homeroom that happens to be taught by whoever created it. The subject is
-- therefore a property of the class itself, on the same footing as `language`:
-- required, not a tag, and the thing that distinguishes a teacher's three
-- otherwise-identical groups from one another.
--
-- Controlled vocabulary via CHECK, mirroring `classes.language` and
-- `quizzes.base_language`. Storing a stable English key rather than free text
-- means every class studying biology carries the SAME value, so grouping and
-- filtering by subject are exact; display names are Hebrew labels in the UI
-- (`components/teacher/classes/labels.ts`), keyed off these values. The list
-- covers the core curriculum plus the technological tracks; `other` is the
-- escape hatch, and adding a subject means extending both this CHECK and
-- `lib/subjects.ts` (the single TypeScript mirror of this list).
--
-- The column is NOT NULL: a class provably has a subject. Existing classes
-- predate the column, so they are backfilled to `other` — visible in the UI as
-- a subject a teacher can correct — before the constraint is applied. No
-- column DEFAULT: every caller states the subject explicitly, so a class never
-- silently lands on `other` because an insert forgot the field.
-- ============================================================

alter table public.classes
  add column if not exists subject text
    check (subject in (
      'math','hebrew','literature','bible','history','civics',
      'english','arabic',
      'physics','chemistry','biology','science',
      'computers','electronics','mechanics','geography',
      'pe','arts','other'
    ));

update public.classes set subject = 'other' where subject is null;

alter table public.classes alter column subject set not null;

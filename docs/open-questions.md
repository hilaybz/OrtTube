# Open design questions

Data-model questions raised for review, with what the current schema actually
does. Each is either **open** (needs a product decision) or **answered** (the
schema settles it; recorded so it is not re-litigated).

Full schema reference: [`docs/data-model.md`](data-model.md).

---

## 1. A teacher who teaches at two schools

**Status: open — needs a product decision.**

**Preference stated:** one profile per teacher, not one per school.

### What the schema does today

A profile belongs to exactly **one** school, permanently:

```sql
-- 010_schema.sql
id        uuid primary key references auth.users(id) on delete cascade,
school_id uuid not null references public.schools(id),   -- immutable (014)
unique (id, school_id)   -- FK target for school-checked composite FKs
```

Three properties compound:

1. **`school_id` is `NOT NULL` and single-valued** — there is no room for a
   second school on a profile.
2. **It is immutable**, enforced by `enforce_profile_immutability()`
   (`014_triggers.sql`) against *every* writer including the service role — not
   just a client-side restriction.
3. **`profiles.id` is the primary key referencing `auth.users(id)`**, so one
   login has exactly one profile.

Point 3 is the practical consequence: **today a teacher at two schools needs two
separate accounts with two different email addresses.** There is no supported
in-app path to the preferred one-profile arrangement.

### Why this is not a one-column change

The single-school assumption is load-bearing across the tenant isolation layer,
not merely a column. `current_school_id()` (`011_helpers.sql`) is defined as:

```sql
select school_id from public.profiles where id = auth.uid()
```

It returns **one** school by construction, and it is the basis of school scoping
in RLS policies and RPCs. `school_id` appears in 11 migration files, including
all of `013_rls.sql`. The composite unique keys (`unique (id, school_id)`) exist
so other tables can carry `school_id` and be FK-checked against the profile's
school — the invariant is enforced structurally, by foreign keys, not only by
policy.

Concretely, a teacher at two schools today would find:

- Their quizzes all carry the school captured at creation, so quizzes authored
  for school B are scoped to school A.
- Shared-quiz browsing (`list_shared_quizzes`, `080_sharing_rpcs.sql`) filters on
  `q.school_id = current_school_id()`, so they see only one school's catalog.
- `clone_quiz` stamps the new quiz with the cloner's single school.

### Options to weigh

| Option | Shape | Cost |
| --- | --- | --- |
| **A. Status quo** | Two accounts, two emails | Zero code. Poor UX; analytics and quizzes never unify. |
| **B. Join table** | `teacher_schools (profile_id, school_id)` | Correct long-term. `current_school_id()` becomes ambiguous, so every RLS policy using it needs rethinking, plus an "active school" concept in the session. |
| **C. Primary + secondary** | Keep `profiles.school_id`, add a grant list | Narrower blast radius; still touches RLS, and encodes an asymmetry that may not reflect reality. |

**Questions to settle before choosing:**

- How common is this? One teacher across two schools, or a routine arrangement?
  B is a significant change to the isolation layer and should be justified by
  real demand.
- If a teacher is in two schools, is a quiz they author visible to both, or to
  the school it was authored *for*? This decides whether "active school" is
  session state or per-resource.
- Do analytics aggregate across a teacher's schools, or stay strictly separated?
  School separation is currently a hard tenant boundary, and relaxing it for
  reporting has privacy implications worth stating explicitly.

---

## 2. `quizzes.cloned_from_id` — shallow or deep?

**Status: answered by the schema. Sub-questions below are open.**

### It is a deep copy, and clones are fully independent

`clone_quiz(p_source_quiz_id)` in `080_sharing_rpcs.sql` inserts **new rows** for
every level of the question tree:

| Row | Behaviour |
| --- | --- |
| `questions` | New rows (kind, position_seconds, order_index copied) |
| `question_options` | New rows (is_correct, order_index copied) |
| `question_translations` | New rows, **every language** |
| `option_translations` | New rows, **every language** |
| `videos` | **Reused** — canonical, shared, ownerless |
| `attempts` / `answers` | **Not copied** — a clone starts with no history |

**Nothing in the question tree is referenced, at any point.** The four `INSERT`s
run inside `clone_quiz` before it returns (`080_sharing_rpcs.sql:135-166`), so a
freshly-cloned quiz owns its rows *immediately* — there is no lazy or
copy-on-write step, and the two quizzes are never sharing question data even
before the first edit. `cloned_from_id` is provenance metadata only; it creates
no runtime coupling. The column could be dropped and both quizzes would behave
identically.

The **video is the sole shared reference**: both quizzes carry the same
`video_id`. That is deliberate — videos are canonical, ownerless and deduped by
`youtube_video_id`, so all quizzes on a video share one cached transcript. It is
safe for isolation because nothing on a video is teacher-editable.

**So: if the cloning teacher edits a question, only their clone changes.** The
source quiz and every other clone are untouched. The reverse also holds — later
edits to the source do **not** propagate into existing clones. A clone is a
point-in-time snapshot.

Also worth knowing:

- The new quiz is always `private` and owned by the caller, regardless of the
  source's visibility.
- It is stamped with the **caller's** school, not the source's.
- Soft-deleted questions and options are **dropped**, not copied — a clone is a
  clean, current copy.
- Read gate: the caller must own the source, or it must be `shared` **and in the
  caller's school**. Cross-school cloning is impossible.

### Open sub-questions

1. **Is snapshot-forever the intended product behaviour?** It is a defensible
   default, but it means a teacher who fixes an error in a shared quiz cannot
   push that fix to anyone who already cloned it, and clones silently drift.
   Worth confirming this is a decision rather than a side effect.
2. **Provenance is lost on hard delete.** `cloned_from_id` is
   `on delete set null` (`010_schema.sql:123`), so hard-deleting a source
   silently orphans the attribution on every clone. Quizzes are normally
   *soft*-deleted, which preserves the link — but the lifecycle purge job is
   worth checking against this.
3. **Is provenance surfaced anywhere?** `cloned_from_id` is stored but the UI
   does not appear to show "cloned from X by Y". If attribution matters to
   teachers sharing work, it needs a surface; if it does not, the column is
   analytics-only and that is fine — just intentional.
4. **Clone chains.** `cloned_from_id` points only at the immediate parent. A
   clone of a clone gives a chain that must be walked to find the origin, and
   the chain breaks at the first hard-deleted ancestor. Acceptable if provenance
   is informational; not if it is ever used for attribution or licensing.
5. **Titles are copied verbatim**, so a teacher who clones lands two
   identically-titled quizzes in their list. Minor, but a likely support
   question — consider a "(עותק)" suffix.

---

## How to verify these claims

Both answers above are read from the migrations, which are the source of truth
(`supabase/migrations/*.sql`).

Cloning has twelve integration tests in `test/sharing/sharing.int.test.ts`,
covering the deep copy, the exclusion of soft-deleted rows and attempts, and
every authorization gate. **None of them assert independence after an edit** —
that the source is unchanged when a clone is modified. The behaviour follows
from the copy being row-level with no shared references, but it is the property
teachers actually depend on, and it is currently unpinned.

Worth adding: clone a quiz, edit a question on the clone, assert the source is
untouched — and the reverse, that editing the source does not alter the clone.

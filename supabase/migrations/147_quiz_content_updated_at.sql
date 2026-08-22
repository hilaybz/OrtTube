-- ============================================================
-- quizzes.content_updated_at — the analytics cutoff
--
-- Editing a quiz's questions or answers invalidates the analytics collected
-- under the old version: `answers.was_correct` is a snapshot taken against the
-- answer key as it stood, a reworded prompt is a different question, and moving a
-- checkpoint from 8:00 to 2:00 makes the same question materially harder (the
-- student has watched six fewer minutes, and the tutor is grounded only in the
-- portion watched so far). Rather than delete anything — the schema soft-deletes
-- everywhere precisely so answer history survives — we stamp the quiz and the
-- analytics readers count only attempts started at or after that stamp
-- (148_analytics_since_content_edit.sql).
--
-- NULL means "never edited": every attempt counts.
--
-- WHAT BUMPS THE STAMP: only a change to what a student is asked or how it is
-- graded — a question or option inserted, soft-deleted or restored; `kind`,
-- `position_seconds`, `order_index`; the base-language prompt, explanation or
-- option text; and `is_correct`. Plus `quizzes.video_id`, which no UI can change
-- today (`update_quiz` handles only title/visibility/base_language) but which
-- would invalidate everything if it ever became editable.
--
-- WHAT DOES NOT: the quiz title, visibility and base_language; a question's
-- `source` provenance flag; and — load-bearing — translation rows in any language
-- other than the quiz's base_language. The translate job writes those on every
-- run, and a machine rendering of an unchanged question invalidates nothing, so
-- bumping on them would reset a teacher's analytics for free.
--
-- CHANGE DETECTION IS THE POINT, not an optimization. Two existing paths resend a
-- complete, unmodified question payload through `upsert_question`: dragging a
-- checkpoint marker (QuizEditor's saveQuestionPosition, which has no
-- position-only endpoint to call) and hitting Save in QuestionModal with nothing
-- edited. A stamp that moved on every authoring call would destroy a term of
-- analytics on a marker nudge. The WHEN clauses below compare OLD to NEW so an
-- identical rewrite is a no-op, and they live on the tables rather than in the
-- RPCs so no caller — RPC, job, or direct write — can sidestep them.
-- ============================================================

alter table public.quizzes
  add column if not exists content_updated_at timestamptz;

-- 012 grants table-level `update` on `quizzes` to authenticated and
-- `quizzes_owner_all` lets a teacher write their own row, so without this a
-- teacher could PATCH the cutoff straight through REST and make stale analytics
-- read as current.
--
-- A column-level `revoke update (content_updated_at)` does NOT work here, and the
-- adjacent `revoke update (role, ...) on profiles` in 012 is worth re-reading with
-- that in mind: in Postgres a table-wide UPDATE grant authorizes every column on
-- its own, and a column-level revoke cannot subtract from it. The privilege has to
-- be dropped at the table level and re-granted per column instead — every column
-- the role holds today except this one, so nothing else about what a teacher may
-- write changes.
revoke update on public.quizzes from anon, authenticated;
grant update (
  id, author_id, video_id, school_id, title,
  base_language, visibility, cloned_from_id, deleted_at, created_at
) on public.quizzes to authenticated;

-- The stamp itself. `now()` is transaction start, so two guards matter:
--   • `content_updated_at < now()` makes this a no-op once per transaction —
--     generating 20 questions stamps once instead of sixty times, and it stops
--     the recursion-free but wasteful churn of restamping the same value.
--   • that same predicate keeps the stamp monotonic: a long edit transaction
--     that commits late can never pull the cutoff backwards over a newer one.
create or replace function public._touch_quiz_content(p_quiz_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.quizzes
     set content_updated_at = now()
   where id = p_quiz_id
     and (content_updated_at is null or content_updated_at < now());
$$;

-- ── questions ────────────────────────────────────────────────────────────────
create or replace function public._tg_touch_quiz_from_question()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._touch_quiz_content(coalesce(new.quiz_id, old.quiz_id));
  return null;
end;
$$;

create or replace trigger questions_touch_quiz_content_ins
  after insert on public.questions
  for each row
  execute function public._tg_touch_quiz_from_question();

create or replace trigger questions_touch_quiz_content_upd
  after update on public.questions
  for each row
  when (
    row(old.kind, old.position_seconds, old.order_index, old.deleted_at)
    is distinct from
    row(new.kind, new.position_seconds, new.order_index, new.deleted_at)
  )
  execute function public._tg_touch_quiz_from_question();

-- ── question_options ─────────────────────────────────────────────────────────
create or replace function public._tg_touch_quiz_from_option()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz_id uuid;
begin
  select q.quiz_id into v_quiz_id
  from public.questions q
  where q.id = coalesce(new.question_id, old.question_id);

  if v_quiz_id is not null then
    perform public._touch_quiz_content(v_quiz_id);
  end if;
  return null;
end;
$$;

create or replace trigger question_options_touch_quiz_content_ins
  after insert on public.question_options
  for each row
  execute function public._tg_touch_quiz_from_option();

create or replace trigger question_options_touch_quiz_content_upd
  after update on public.question_options
  for each row
  when (
    row(old.is_correct, old.order_index, old.deleted_at)
    is distinct from
    row(new.is_correct, new.order_index, new.deleted_at)
  )
  execute function public._tg_touch_quiz_from_option();

-- ── question_translations (base language only) ────────────────────────────────
-- `source` is deliberately absent from the UPDATE guard: it records whether a
-- question was authored, generated or translated, carries no grading weight, and
-- flipping it changes nothing a student saw.
create or replace function public._tg_touch_quiz_from_question_translation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz_id   uuid;
  v_base_lang text;
begin
  select q.quiz_id, z.base_language into v_quiz_id, v_base_lang
  from public.questions q
  join public.quizzes z on z.id = q.quiz_id
  where q.id = coalesce(new.question_id, old.question_id);

  if v_quiz_id is null then
    return null;
  end if;
  -- A translation into any other language is not an edit to the question.
  if coalesce(new.language, old.language) is distinct from v_base_lang then
    return null;
  end if;

  perform public._touch_quiz_content(v_quiz_id);
  return null;
end;
$$;

create or replace trigger question_translations_touch_quiz_content_ins
  after insert on public.question_translations
  for each row
  execute function public._tg_touch_quiz_from_question_translation();

create or replace trigger question_translations_touch_quiz_content_upd
  after update on public.question_translations
  for each row
  when (
    row(old.prompt, old.explanation)
    is distinct from
    row(new.prompt, new.explanation)
  )
  execute function public._tg_touch_quiz_from_question_translation();

-- ── option_translations (base language only) ──────────────────────────────────
create or replace function public._tg_touch_quiz_from_option_translation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz_id   uuid;
  v_base_lang text;
begin
  select q.quiz_id, z.base_language into v_quiz_id, v_base_lang
  from public.question_options o
  join public.questions q on q.id = o.question_id
  join public.quizzes z on z.id = q.quiz_id
  where o.id = coalesce(new.option_id, old.option_id);

  if v_quiz_id is null then
    return null;
  end if;
  if coalesce(new.language, old.language) is distinct from v_base_lang then
    return null;
  end if;

  perform public._touch_quiz_content(v_quiz_id);
  return null;
end;
$$;

create or replace trigger option_translations_touch_quiz_content_ins
  after insert on public.option_translations
  for each row
  execute function public._tg_touch_quiz_from_option_translation();

create or replace trigger option_translations_touch_quiz_content_upd
  after update on public.option_translations
  for each row
  when (old.text is distinct from new.text)
  execute function public._tg_touch_quiz_from_option_translation();

-- ── quizzes.video_id ─────────────────────────────────────────────────────────
-- Repointing a quiz at a different video invalidates everything — the questions
-- describe footage nobody watched. BEFORE UPDATE writing NEW is what keeps this
-- recursion-free: `_touch_quiz_content` issues an UPDATE on `quizzes`, and this
-- trigger's WHEN clause ignores it because `video_id` is unchanged there.
create or replace function public._tg_touch_quiz_on_video_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.content_updated_at := now();
  return new;
end;
$$;

create or replace trigger quizzes_touch_content_on_video_change
  before update on public.quizzes
  for each row
  when (old.video_id is distinct from new.video_id)
  execute function public._tg_touch_quiz_on_video_change();

-- The analytics predicate is `started_at >= content_updated_at` per quiz;
-- idx_attempts_quiz_completed(quiz_id, completed_at) can't serve it.
create index if not exists idx_attempts_quiz_started
  on public.attempts(quiz_id, started_at);

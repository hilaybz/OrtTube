-- ============================================================
-- Sharing & clone RPCs (spec §3.4 / decision 13)
--
-- Read-only sharing within a school + clone-as-deep-copy. Both are SECURITY
-- DEFINER so they can read/write the answer-key structural rows and the shared
-- `videos` reference while still enforcing access via auth.uid():
--
--   • list_shared_quizzes()  — the browse surface: every non-deleted `shared`
--     quiz in the CALLER'S school. Teacher-only (a student gets an empty set),
--     mirroring the `quizzes_shared_select` RLS policy (013): shared reads are
--     gated on is_active_teacher() so a student can never see the answer key.
--
--   • clone_quiz(source_quiz_id) — deep-copy a quiz the caller may READ (owner OR
--     shared-same-school) into a NEW private quiz owned by the caller, with
--     cloned_from_id set. The shared `video` row is REUSED (not duplicated). All
--     NON-DELETED questions + question_options are copied, together with their
--     question_translations / option_translations rows (every language). Attempts
--     and answers are NOT copied (a clone starts with no history).
--
-- Stable error codes (raised as the exception MESSAGE; SQLSTATE P0001/P0002):
--   not_authorized  — caller is not an active teacher, or may not read the source
--   quiz_not_found  — source quiz id does not exist
--   quiz_deleted    — source quiz is soft-deleted
-- ============================================================

-- ── list_shared_quizzes ───────────────────────────────────────────────────────
-- The same-school shared-quiz catalog for the browse-and-clone surface. Only an
-- ACTIVE TEACHER in the quiz's school sees rows (is_active_teacher() is false for
-- students and deactivated teachers, so the guarded predicate yields nothing).
-- Includes the caller's own shared quizzes; `is_own` lets the UI distinguish them.
create or replace function public.list_shared_quizzes()
returns table (
  quiz_id           uuid,
  title             text,
  base_language     text,
  visibility        text,
  video_id          uuid,
  youtube_video_id  text,
  video_title       text,
  transcript_status text,
  question_count    bigint,
  author_id         uuid,
  author_name       text,
  is_own            boolean,
  created_at        timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    q.id,
    q.title,
    q.base_language,
    q.visibility,
    v.id,
    v.youtube_video_id,
    v.title,
    v.transcript_status,
    (select count(*) from public.questions qs
      where qs.quiz_id = q.id and qs.deleted_at is null),
    q.author_id,
    p.display_name,
    (q.author_id = auth.uid()),
    q.created_at
  from public.quizzes q
  join public.videos   v on v.id = q.video_id
  left join public.profiles p on p.id = q.author_id
  where q.visibility = 'shared'
    and q.deleted_at is null
    and q.school_id = public.current_school_id()
    and public.is_active_teacher()
  order by q.created_at desc;
$$;

-- ── clone_quiz ────────────────────────────────────────────────────────────────
-- Deep-copy a readable quiz into a new PRIVATE quiz owned by the caller, reusing
-- the shared video. Returns the new quiz id. Read access = owner OR
-- (shared AND same-school); a non-same-school teacher can neither read nor clone.
--
-- The correctness constraint trigger (014) is DEFERRED, so inserting each cloned
-- option one-by-one is safe: only the committed final state is validated, and it
-- mirrors the source's (already valid) live option set.
create or replace function public.clone_quiz(p_source_quiz_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src      public.quizzes;
  v_school   uuid;
  v_new_quiz uuid;
  v_q        public.questions;
  v_new_qid  uuid;
  v_o        public.question_options;
  v_new_oid  uuid;
begin
  -- Caller must be an ACTIVE TEACHER; derive their school for the same-school
  -- read check and the new quiz's school_id.
  select school_id into v_school
  from public.profiles
  where id = auth.uid() and role = 'teacher' and deactivated_at is null;
  if not found then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select * into v_src from public.quizzes where id = p_source_quiz_id;
  if not found then
    raise exception 'quiz_not_found' using errcode = 'P0002';
  end if;
  if v_src.deleted_at is not null then
    raise exception 'quiz_deleted' using errcode = 'P0001';
  end if;

  -- Read gate: the caller must own the source, or it must be shared in their
  -- school. (An owner's quiz is always in their own school, so owners pass.)
  if v_src.author_id <> auth.uid()
     and not (v_src.visibility = 'shared' and v_src.school_id = v_school) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  -- New private quiz owned by the caller, REUSING the shared video row.
  insert into public.quizzes
    (author_id, video_id, school_id, title, base_language, visibility, cloned_from_id)
  values
    (auth.uid(), v_src.video_id, v_school, v_src.title, v_src.base_language,
     'private', v_src.id)
  returning id into v_new_quiz;

  -- Copy every NON-DELETED question, its translations, its non-deleted options,
  -- and those options' translations. Soft-deleted rows are intentionally dropped
  -- (a clone is a clean, current copy). Attempts/answers are never copied.
  for v_q in
    select * from public.questions
    where quiz_id = p_source_quiz_id and deleted_at is null
    order by order_index, id
  loop
    insert into public.questions (quiz_id, kind, position_seconds, order_index)
    values (v_new_quiz, v_q.kind, v_q.position_seconds, v_q.order_index)
    returning id into v_new_qid;

    insert into public.question_translations
      (question_id, language, prompt, explanation, source)
    select v_new_qid, qt.language, qt.prompt, qt.explanation, qt.source
    from public.question_translations qt
    where qt.question_id = v_q.id;

    for v_o in
      select * from public.question_options
      where question_id = v_q.id and deleted_at is null
      order by order_index, id
    loop
      insert into public.question_options (question_id, is_correct, order_index)
      values (v_new_qid, v_o.is_correct, v_o.order_index)
      returning id into v_new_oid;

      insert into public.option_translations (option_id, language, text)
      select v_new_oid, ot.language, ot.text
      from public.option_translations ot
      where ot.option_id = v_o.id;
    end loop;
  end loop;

  return v_new_quiz;
end;
$$;

-- ── GRANTs ────────────────────────────────────────────────────────────────────
-- Invoked by the teacher's authenticated session so auth.uid() resolves to the
-- caller; service_role may also call.
-- Strip the default PUBLIC EXECUTE first so only the roles granted below can call
-- these SECURITY DEFINER RPCs.
revoke all on function public.list_shared_quizzes()  from public;
revoke all on function public.clone_quiz(uuid)       from public;

grant execute on function public.list_shared_quizzes()  to authenticated, service_role;
grant execute on function public.clone_quiz(uuid)       to authenticated, service_role;

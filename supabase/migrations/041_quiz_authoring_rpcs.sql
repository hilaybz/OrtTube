-- ============================================================
-- Quiz / question / option authoring RPCs (spec §3.4)
--
-- All owner-only + default-deny + SECURITY DEFINER (they run as the definer, so
-- they may write the shared `videos` row and the answer-key structural rows while
-- still enforcing ownership via auth.uid()). Every mutation:
--   • verifies the caller is a NON-DEACTIVATED teacher who AUTHORED the quiz,
--   • keeps the answer key (`is_correct`) on the structural row — translations
--     only ever carry text,
--   • pre-validates correctness so callers get a friendly, stable error code
--     rather than the raw 23514 the deferred trigger raises at commit.
--
-- Stable error codes (raised as the exception MESSAGE; SQLSTATE P0001/P0002):
--   quiz_not_found, quiz_deleted, not_owner, not_authorized, invalid_kind,
--   invalid_visibility, invalid_base_language, no_options, question_not_found,
--   option_not_found, single_needs_exactly_one_correct,
--   needs_at_least_one_correct, cannot_remove_last_correct.
-- ============================================================

-- Internal owner guard: returns the quiz row if the current user is an active
-- teacher who authored it; raises a stable code otherwise. SECURITY DEFINER so
-- its reads are not blocked by RLS.
create or replace function public._assert_quiz_owner(p_quiz_id uuid)
returns public.quizzes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz public.quizzes;
begin
  select * into v_quiz from public.quizzes where id = p_quiz_id;
  if not found then
    raise exception 'quiz_not_found' using errcode = 'P0002';
  end if;
  if v_quiz.deleted_at is not null then
    raise exception 'quiz_deleted' using errcode = 'P0001';
  end if;
  if v_quiz.author_id <> auth.uid() then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'teacher' and deactivated_at is null
  ) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  return v_quiz;
end;
$$;

-- ── create_quiz_for_video ─────────────────────────────────────────────────────
-- Atomic "canonical video + first quiz" in ONE transaction (spec §3.3: orphan-GC
-- can't race). Metadata is fetched in Node (fetchVideoMetadata) and passed
-- in; the shared `videos` row is upserted ON CONFLICT DO NOTHING so an existing
-- row is NEVER downgraded. Subsequent quizzes on the same video just insert a
-- `quizzes` row (this RPC also handles that — the video upsert is a no-op then).
create or replace function public.create_quiz_for_video(
  p_youtube_id       text,
  p_video_title      text,
  p_duration_seconds int,
  p_base_language    text,
  p_quiz_title       text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid;
  v_video_id  uuid;
  v_status    text;
  v_quiz      public.quizzes;
begin
  -- Caller must be an active teacher; derive the school from their profile.
  select school_id into v_school_id
  from public.profiles
  where id = auth.uid() and role = 'teacher' and deactivated_at is null;
  if not found then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if p_base_language is null or p_base_language not in ('he','ar','en') then
    raise exception 'invalid_base_language' using errcode = 'P0001';
  end if;

  -- Upsert the shared, ownerless video row (dedup by youtube_video_id). DO
  -- NOTHING preserves an existing row's title/duration/transcript_status.
  insert into public.videos (youtube_video_id, title, duration_seconds)
  values (p_youtube_id, p_video_title, p_duration_seconds)
  on conflict (youtube_video_id) do nothing;

  select id, transcript_status into v_video_id, v_status
  from public.videos where youtube_video_id = p_youtube_id;

  insert into public.quizzes (author_id, video_id, school_id, base_language, title)
  values (auth.uid(), v_video_id, v_school_id, p_base_language, p_quiz_title)
  returning * into v_quiz;

  return jsonb_build_object(
    'quiz_id',           v_quiz.id,
    'video_id',          v_video_id,
    'youtube_video_id',  p_youtube_id,
    'school_id',         v_school_id,
    'base_language',     v_quiz.base_language,
    'title',             v_quiz.title,
    'visibility',        v_quiz.visibility,
    'transcript_status', v_status,
    'created_at',        v_quiz.created_at
  );
end;
$$;

-- ── upsert_question ───────────────────────────────────────────────────────────
-- Inserts (p_question_id NULL) or updates a question plus its base-language
-- translation and the full option set. Each option is
-- {option_id?, is_correct, order_index, base_text}. `p_source` is 'authored'
-- (manual) or 'generated' (AI). Options are UPSERTED — omitted existing options
-- are left intact (use soft_delete_option to remove one). Correctness is
-- re-checked against the live (non-deleted) option set so the friendly code is
-- accurate even on edits.
create or replace function public.upsert_question(
  p_quiz_id          uuid,
  p_question_id      uuid,
  p_kind             text,
  p_position_seconds int,
  p_order_index      int,
  p_base_prompt      text,
  p_base_explanation text,
  p_options          jsonb,
  p_source           text default 'authored'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz         public.quizzes;
  v_base_lang    text;
  v_qid          uuid;
  v_opt          jsonb;
  v_opt_id       uuid;
  v_correct_live int;
begin
  v_quiz := public._assert_quiz_owner(p_quiz_id);
  v_base_lang := v_quiz.base_language;

  if p_kind not in ('single','multi') then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;
  if p_source not in ('authored','generated','translated') then
    raise exception 'invalid_source' using errcode = 'P0001';
  end if;
  if p_options is null
     or jsonb_typeof(p_options) <> 'array'
     or jsonb_array_length(p_options) = 0 then
    raise exception 'no_options' using errcode = 'P0001';
  end if;

  -- Question row (insert or update; un-soft-delete on update).
  if p_question_id is null then
    insert into public.questions (quiz_id, kind, position_seconds, order_index)
    values (p_quiz_id, p_kind, p_position_seconds, p_order_index)
    returning id into v_qid;
  else
    if not exists (
      select 1 from public.questions
      where id = p_question_id and quiz_id = p_quiz_id
    ) then
      raise exception 'question_not_found' using errcode = 'P0002';
    end if;
    update public.questions
      set kind = p_kind,
          position_seconds = p_position_seconds,
          order_index = p_order_index,
          deleted_at = null
      where id = p_question_id;
    v_qid := p_question_id;
  end if;

  -- Base-language question translation (prompt + explanation).
  insert into public.question_translations (question_id, language, prompt, explanation, source)
  values (v_qid, v_base_lang, p_base_prompt, p_base_explanation, p_source)
  on conflict (question_id, language) do update
    set prompt = excluded.prompt,
        explanation = excluded.explanation,
        source = excluded.source;

  -- Options + their base-language text.
  for v_opt in select * from jsonb_array_elements(p_options)
  loop
    if (v_opt ? 'option_id') and coalesce(v_opt->>'option_id','') <> '' then
      v_opt_id := (v_opt->>'option_id')::uuid;
      if not exists (
        select 1 from public.question_options
        where id = v_opt_id and question_id = v_qid
      ) then
        raise exception 'option_not_found' using errcode = 'P0002';
      end if;
      update public.question_options
        set is_correct  = coalesce((v_opt->>'is_correct')::boolean, false),
            order_index = coalesce((v_opt->>'order_index')::int, 0),
            deleted_at  = null
        where id = v_opt_id;
    else
      insert into public.question_options (question_id, is_correct, order_index)
      values (
        v_qid,
        coalesce((v_opt->>'is_correct')::boolean, false),
        coalesce((v_opt->>'order_index')::int, 0)
      )
      returning id into v_opt_id;
    end if;

    insert into public.option_translations (option_id, language, text)
    values (v_opt_id, v_base_lang, coalesce(v_opt->>'base_text',''))
    on conflict (option_id, language) do update
      set text = excluded.text;
  end loop;

  -- Friendly correctness pre-check against the live option set (the deferred
  -- 23514 trigger is the backstop).
  select count(*) into v_correct_live
  from public.question_options
  where question_id = v_qid and is_correct = true and deleted_at is null;

  if p_kind = 'single' and v_correct_live <> 1 then
    raise exception 'single_needs_exactly_one_correct' using errcode = 'P0001';
  elsif p_kind = 'multi' and v_correct_live < 1 then
    raise exception 'needs_at_least_one_correct' using errcode = 'P0001';
  end if;

  return v_qid;
end;
$$;

-- ── soft_delete_option ────────────────────────────────────────────────────────
-- Soft-deletes an option (never hard-delete: preserves answer_selections
-- distractor history). Pre-checks so removing the last live correct option of a
-- question returns `cannot_remove_last_correct` instead of the raw deferred
-- 23514 at commit. Idempotent.
create or replace function public.soft_delete_option(p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_question_id uuid;
  v_is_correct  boolean;
  v_deleted     timestamptz;
  v_quiz_id     uuid;
  v_kind        text;
  v_other_correct int;
begin
  select qo.question_id, qo.is_correct, qo.deleted_at, q.quiz_id, q.kind
    into v_question_id, v_is_correct, v_deleted, v_quiz_id, v_kind
  from public.question_options qo
  join public.questions q on q.id = qo.question_id
  where qo.id = p_option_id;

  if not found then
    raise exception 'option_not_found' using errcode = 'P0002';
  end if;

  perform public._assert_quiz_owner(v_quiz_id);

  if v_deleted is not null then
    return;  -- already gone; idempotent
  end if;

  if v_is_correct then
    select count(*) into v_other_correct
    from public.question_options
    where question_id = v_question_id
      and id <> p_option_id
      and is_correct = true
      and deleted_at is null;
    if v_other_correct = 0 then
      raise exception 'cannot_remove_last_correct' using errcode = 'P0001';
    end if;
  end if;

  update public.question_options set deleted_at = now() where id = p_option_id;
end;
$$;

-- ── soft_delete_question ──────────────────────────────────────────────────────
-- Soft-deletes a whole question (hides from new reads/attempts; rows survive so
-- past answers keep their snapshot). The deferred correctness trigger skips
-- soft-deleted questions, so no key pre-check is needed here. Idempotent.
create or replace function public.soft_delete_question(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz_id uuid;
  v_deleted timestamptz;
begin
  select q.quiz_id, q.deleted_at into v_quiz_id, v_deleted
  from public.questions q where q.id = p_question_id;
  if not found then
    raise exception 'question_not_found' using errcode = 'P0002';
  end if;

  perform public._assert_quiz_owner(v_quiz_id);

  if v_deleted is not null then
    return;  -- idempotent
  end if;

  update public.questions set deleted_at = now() where id = p_question_id;
end;
$$;

-- ── update_quiz ───────────────────────────────────────────────────────────────
-- Updates the quiz's title / visibility / base_language (all optional — NULL
-- leaves the column unchanged). Changing base_language does NOT re-translate
-- existing rows (documented limitation; future re-generate action).
create or replace function public.update_quiz(
  p_quiz_id       uuid,
  p_title         text default null,
  p_visibility    text default null,
  p_base_language text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert_quiz_owner(p_quiz_id);

  if p_visibility is not null and p_visibility not in ('private','shared') then
    raise exception 'invalid_visibility' using errcode = 'P0001';
  end if;
  if p_base_language is not null and p_base_language not in ('he','ar','en') then
    raise exception 'invalid_base_language' using errcode = 'P0001';
  end if;

  update public.quizzes
    set title         = coalesce(p_title, title),
        visibility    = coalesce(p_visibility, visibility),
        base_language = coalesce(p_base_language, base_language)
    where id = p_quiz_id;
end;
$$;

-- ── soft_delete_quiz ──────────────────────────────────────────────────────────
create or replace function public.soft_delete_quiz(p_quiz_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert_quiz_owner(p_quiz_id);
  update public.quizzes set deleted_at = now()
    where id = p_quiz_id and deleted_at is null;
end;
$$;

-- ── list_my_quizzes ───────────────────────────────────────────────────────────
-- The teacher's own-quizzes library (incl. UNASSIGNED quizzes, §10.10). A thin
-- helper over an owner-scoped select + video join + live question count.
create or replace function public.list_my_quizzes()
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
    q.created_at
  from public.quizzes q
  join public.videos v on v.id = q.video_id
  where q.author_id = auth.uid()
    and q.deleted_at is null
  order by q.created_at desc;
$$;

-- ── GRANTs (authoring is invoked by the teacher's authenticated session so
-- auth.uid() resolves to the owner; service_role may also call) ───────────────
-- Strip the default PUBLIC EXECUTE first (a fresh function is world-executable),
-- so only the roles granted below can call these SECURITY DEFINER RPCs.
revoke all on function public._assert_quiz_owner(uuid)                           from public;
revoke all on function public.create_quiz_for_video(text, text, int, text, text) from public;
revoke all on function public.upsert_question(uuid, uuid, text, int, int, text, text, jsonb, text) from public;
revoke all on function public.soft_delete_option(uuid)                           from public;
revoke all on function public.soft_delete_question(uuid)                         from public;
revoke all on function public.update_quiz(uuid, text, text, text)                from public;
revoke all on function public.soft_delete_quiz(uuid)                             from public;
revoke all on function public.list_my_quizzes()                                  from public;

grant execute on function public._assert_quiz_owner(uuid)                           to authenticated, service_role;
grant execute on function public.create_quiz_for_video(text, text, int, text, text) to authenticated, service_role;
grant execute on function public.upsert_question(uuid, uuid, text, int, int, text, text, jsonb, text) to authenticated, service_role;
grant execute on function public.soft_delete_option(uuid)                           to authenticated, service_role;
grant execute on function public.soft_delete_question(uuid)                         to authenticated, service_role;
grant execute on function public.update_quiz(uuid, text, text, text)                to authenticated, service_role;
grant execute on function public.soft_delete_quiz(uuid)                             to authenticated, service_role;
grant execute on function public.list_my_quizzes()                                  to authenticated, service_role;

-- ============================================================
-- Class assignment RPCs (spec §3.5)
--
-- class_quizzes is SELECT-only for `authenticated` (012_grants); its writes go
-- through these SECURITY DEFINER RPCs so the SAME-SCHOOL guard between the class
-- and the quiz — which is enforced by the RPC, NOT a composite FK (spec §3.5) —
-- can't be bypassed by a direct owner-RLS write.
--
-- Assignment stores the per-class delivery settings `tutor_mode` + `max_attempts`
-- (spec decision 8: "quizzes hold content; assignments hold delivery"). The RPC
-- returns the class language so the Node caller (lib/classes.ts) can fire the
-- best-effort eager translation into classes.language (ensureTranslation)
-- without a second round-trip.
--
-- The student feed (list_assigned_for_student) intentionally does NOT hide a
-- deactivated teacher's assigned quizzes — deactivation gates the OWNER's access,
-- not enrolled students' (plan Appendix C). It only hides soft-deleted quizzes.
--
-- Stable error codes: class_not_found, not_owner, not_authorized,
--   quiz_not_found, cross_school, quiz_forbidden, invalid_tutor_mode,
--   invalid_max_attempts.
-- ============================================================

-- ── assign_quiz_to_class ──────────────────────────────────────────────────────
-- Upsert the (class, quiz) assignment with its per-class tutor_mode/max_attempts.
--   • class owner-checked (active teacher),
--   • quiz must exist, be non-deleted, and share the class's school,
--   • the caller must be the quiz author OR the quiz must be 'shared'
--     (so a private quiz owned by a different teacher can't be assigned).
-- max_attempts: NULL = unlimited; otherwise >= 1. Returns the stored assignment
-- plus base_language / class_language for the translation hook.
create or replace function public.assign_quiz_to_class(
  p_class_id     uuid,
  p_quiz_id      uuid,
  p_tutor_mode   text default 'hints',
  p_max_attempts int  default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class public.classes;
  v_quiz  public.quizzes;
begin
  v_class := public._assert_class_owner(p_class_id);

  if p_tutor_mode is null or p_tutor_mode not in ('off','hints','full') then
    raise exception 'invalid_tutor_mode' using errcode = 'P0001';
  end if;
  if p_max_attempts is not null and p_max_attempts < 1 then
    raise exception 'invalid_max_attempts' using errcode = 'P0001';
  end if;

  select * into v_quiz from public.quizzes where id = p_quiz_id;
  if not found or v_quiz.deleted_at is not null then
    raise exception 'quiz_not_found' using errcode = 'P0002';
  end if;
  if v_quiz.school_id <> v_class.school_id then
    raise exception 'cross_school' using errcode = 'P0001';
  end if;
  if v_quiz.author_id <> auth.uid() and v_quiz.visibility <> 'shared' then
    raise exception 'quiz_forbidden' using errcode = 'P0001';
  end if;

  insert into public.class_quizzes (class_id, quiz_id, tutor_mode, max_attempts)
    values (p_class_id, p_quiz_id, p_tutor_mode, p_max_attempts)
    on conflict (class_id, quiz_id) do update
      set tutor_mode   = excluded.tutor_mode,
          max_attempts = excluded.max_attempts;

  return jsonb_build_object(
    'class_id',       p_class_id,
    'quiz_id',        p_quiz_id,
    'tutor_mode',     p_tutor_mode,
    'max_attempts',   p_max_attempts,
    'class_language', v_class.language,
    'base_language',  v_quiz.base_language
  );
end;
$$;

-- ── unassign_quiz ─────────────────────────────────────────────────────────────
-- Remove an assignment (idempotent). Cascades away nothing on the quiz itself;
-- past attempts in the class survive (attempts reference class_id/quiz_id).
create or replace function public.unassign_quiz(
  p_class_id uuid,
  p_quiz_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert_class_owner(p_class_id);
  delete from public.class_quizzes
    where class_id = p_class_id and quiz_id = p_quiz_id;
end;
$$;

-- ── list_class_quizzes ────────────────────────────────────────────────────────
-- Owner-facing list of a class's assigned quizzes (non-deleted) with the video +
-- delivery settings + a live question count.
create or replace function public.list_class_quizzes(p_class_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert_class_owner(p_class_id);
  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'quiz_id',          q.id,
               'title',            q.title,
               'base_language',    q.base_language,
               'visibility',       q.visibility,
               'video_id',         v.id,
               'youtube_video_id', v.youtube_video_id,
               'video_title',      v.title,
               'tutor_mode',       cq.tutor_mode,
               'max_attempts',     cq.max_attempts,
               'assigned_at',      cq.assigned_at,
               'question_count',   (
                 select count(*) from public.questions qs
                 where qs.quiz_id = q.id and qs.deleted_at is null
               )
             ) order by cq.assigned_at desc
           )
    from public.class_quizzes cq
    join public.quizzes q on q.id = cq.quiz_id
    join public.videos  v on v.id = q.video_id
    where cq.class_id = p_class_id
      and q.deleted_at is null
  ), '[]'::jsonb);
end;
$$;

-- ── list_assigned_for_student ─────────────────────────────────────────────────
-- The signed-in student's class-tabbed feed: each class they belong to, with the
-- assigned NON-DELETED quizzes in it. Membership is implicit (m.student_id =
-- auth.uid()); a deactivated teacher's assigned quizzes stay visible (plan
-- Appendix C). Empty classes still appear as tabs (empty quizzes array).
create or replace function public.list_assigned_for_student()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'class_id',   c.id,
               'class_name', c.name,
               'language',   c.language,
               'quizzes',    coalesce((
                 select jsonb_agg(
                          jsonb_build_object(
                            'quiz_id',          q.id,
                            'title',            q.title,
                            'base_language',    q.base_language,
                            'video_id',         v.id,
                            'youtube_video_id', v.youtube_video_id,
                            'video_title',      v.title,
                            'tutor_mode',       cq.tutor_mode,
                            'max_attempts',     cq.max_attempts,
                            'assigned_at',      cq.assigned_at
                          ) order by cq.assigned_at desc
                        )
                 from public.class_quizzes cq
                 join public.quizzes q on q.id = cq.quiz_id
                 join public.videos  v on v.id = q.video_id
                 where cq.class_id = c.id
                   and q.deleted_at is null
               ), '[]'::jsonb)
             ) order by c.name
           )
    from public.class_members m
    join public.classes c on c.id = m.class_id
    where m.student_id = auth.uid()
  ), '[]'::jsonb);
end;
$$;

-- ── GRANTs ────────────────────────────────────────────────────────────────────
-- Assignment RPCs are invoked by the owning teacher's authenticated session;
-- list_assigned_for_student by the student's. service_role may also call.
-- Strip the default PUBLIC EXECUTE first so only the roles granted below can call
-- these SECURITY DEFINER RPCs.
revoke all on function public.assign_quiz_to_class(uuid, uuid, text, int) from public;
revoke all on function public.unassign_quiz(uuid, uuid)                   from public;
revoke all on function public.list_class_quizzes(uuid)                    from public;
revoke all on function public.list_assigned_for_student()                 from public;

grant execute on function public.assign_quiz_to_class(uuid, uuid, text, int) to authenticated, service_role;
grant execute on function public.unassign_quiz(uuid, uuid)                   to authenticated, service_role;
grant execute on function public.list_class_quizzes(uuid)                    to authenticated, service_role;
grant execute on function public.list_assigned_for_student()                 to authenticated, service_role;

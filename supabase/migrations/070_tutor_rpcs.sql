-- ============================================================
-- AI tutor support (spec §5)
--
-- The /ask route needs the per-class tutor_mode plus the language + canonical
-- video context to build a spoiler-bounded, correctly-localized tutor prompt.
-- Students have NO direct SELECT on class_quizzes (013_rls: owner-only SELECT),
-- so this SECURITY DEFINER RPC reads it for them — but only after enforcing that
-- the caller is a member of the class and the quiz is actually assigned there.
--
-- It bundles everything the route needs into ONE round-trip:
--   • tutor_mode         — 'off' | 'hints' | 'full' ('off' → route returns 403)
--   • class/base language + the student's preferred_language → resolveLanguage()
--   • video_id (canonical FK, for the tutor_questions log)
--   • youtube_video_id   → transcript fetch/slice
--
-- Called through the AUTHENTICATED (RLS-subject) client so auth.uid() is the
-- signed-in student. SECURITY DEFINER only elevates the internal reads; the
-- membership gate below is what authorizes the call.
--
-- Stable error codes (SQLSTATE P0001): not_authenticated, not_member,
--   not_assigned.
-- ============================================================

create or replace function public.get_tutor_mode(
  p_class_id uuid,
  p_quiz_id  uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid                uuid := auth.uid();
  v_mode               text;
  v_class_language     text;
  v_base_language      text;
  v_preferred_language text;
  v_video_id           uuid;
  v_youtube_video_id   text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- Membership gate: only students enrolled in the class may tutor its quizzes.
  if not public.is_member_of_class(p_class_id) then
    raise exception 'not_member' using errcode = 'P0001';
  end if;

  -- Assignment + content context in one join. No deleted_at filter on the quiz:
  -- an assigned quiz stays tutorable for enrolled students (plan Appendix C —
  -- deactivation/removal gates the owner, not enrolled students).
  select cq.tutor_mode, c.language, q.base_language, q.video_id, v.youtube_video_id
    into v_mode, v_class_language, v_base_language, v_video_id, v_youtube_video_id
    from public.class_quizzes cq
    join public.classes c on c.id = cq.class_id
    join public.quizzes  q on q.id = cq.quiz_id
    join public.videos   v on v.id = q.video_id
   where cq.class_id = p_class_id
     and cq.quiz_id  = p_quiz_id;

  if not found then
    raise exception 'not_assigned' using errcode = 'P0001';
  end if;

  select preferred_language
    into v_preferred_language
    from public.profiles
   where id = v_uid;

  return jsonb_build_object(
    'tutor_mode',         v_mode,
    'class_language',     v_class_language,
    'base_language',      v_base_language,
    'preferred_language', v_preferred_language,
    'video_id',           v_video_id,
    'youtube_video_id',   v_youtube_video_id
  );
end;
$$;

revoke all on function public.get_tutor_mode(uuid, uuid) from public;
grant execute on function public.get_tutor_mode(uuid, uuid) to authenticated, service_role;

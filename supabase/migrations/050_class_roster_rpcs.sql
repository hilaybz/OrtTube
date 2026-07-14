-- ============================================================
-- Class roster RPCs (spec §3.2)
--
-- class_members / class_invites are SELECT-only for `authenticated` (012_grants):
-- their writes go through these SECURITY DEFINER RPCs so the cross-school /
-- role guards can't be bypassed by a direct owner-RLS write. Every mutation:
--   • verifies the caller is a NON-DEACTIVATED teacher who OWNS the class
--     (via _assert_class_owner → stable error codes, not raw RLS denials),
--   • normalises the email (citext + trim) before matching/inserting.
--
-- The add-by-email SAME-SCHOOL guard is load-bearing: the composite FK on
-- class_members is role-checked, NOT school-checked (spec §3.5), so without this
-- an owner could enroll another school's student and leak that school's
-- classes/quizzes/tutor to them via membership-based RLS.
--
-- Stable error codes (raised as the exception MESSAGE; SQLSTATE P0001/P0002):
--   class_not_found, not_owner, not_authorized, invalid_email,
--   cross_school, is_teacher.
-- ============================================================

-- Internal owner guard: returns the class row if the current user is an active
-- teacher who owns it; raises a stable code otherwise. SECURITY DEFINER so its
-- reads are not blocked by RLS.
create or replace function public._assert_class_owner(p_class_id uuid)
returns public.classes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class public.classes;
begin
  select * into v_class from public.classes where id = p_class_id;
  if not found then
    raise exception 'class_not_found' using errcode = 'P0002';
  end if;
  if v_class.teacher_id <> auth.uid() then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'teacher' and deactivated_at is null
  ) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  return v_class;
end;
$$;

-- ── add_student_to_class ──────────────────────────────────────────────────────
-- Enroll an existing same-school student, or fall back to a pending invite that
-- the invite-conversion trigger converts on that student's signup. No email
-- is sent in v1. Idempotent (ON CONFLICT DO NOTHING on both paths).
--   • student, same school  → insert class_members    → {status:'added'}
--   • student, other school → raise 'cross_school'
--   • teacher               → raise 'is_teacher'
--   • no such profile       → insert class_invites     → {status:'invited'}
create or replace function public.add_student_to_class(
  p_class_id uuid,
  p_email    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class   public.classes;
  v_email   citext;
  v_profile public.profiles;
begin
  v_class := public._assert_class_owner(p_class_id);

  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;
  v_email := trim(p_email)::citext;

  select * into v_profile from public.profiles where email = v_email;

  if found then
    if v_profile.role = 'teacher' then
      raise exception 'is_teacher' using errcode = 'P0001';
    end if;
    -- role = 'student'
    if v_profile.school_id <> v_class.school_id then
      raise exception 'cross_school' using errcode = 'P0001';
    end if;
    insert into public.class_members (class_id, student_id)
      values (p_class_id, v_profile.id)
      on conflict (class_id, student_id) do nothing;
    return jsonb_build_object('status', 'added', 'student_id', v_profile.id);
  else
    insert into public.class_invites (class_id, email)
      values (p_class_id, v_email)
      on conflict (class_id, email) do nothing;
    return jsonb_build_object('status', 'invited', 'email', v_email::text);
  end if;
end;
$$;

-- ── remove_student_from_class ─────────────────────────────────────────────────
-- Un-enroll a student (idempotent). Their attempts/tutor_questions survive.
create or replace function public.remove_student_from_class(
  p_class_id   uuid,
  p_student_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert_class_owner(p_class_id);
  delete from public.class_members
    where class_id = p_class_id and student_id = p_student_id;
end;
$$;

-- ── revoke_invite ─────────────────────────────────────────────────────────────
-- Withdraw a pending invite before the invited student signs up (idempotent).
create or replace function public.revoke_invite(
  p_class_id uuid,
  p_email    text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert_class_owner(p_class_id);
  delete from public.class_invites
    where class_id = p_class_id and email = trim(p_email)::citext;
end;
$$;

-- ── list_class_roster ─────────────────────────────────────────────────────────
-- The class roster: enrolled members (with profile detail) + pending invites.
-- Owner-only; SECURITY DEFINER so it can read the students' profile rows the
-- owner is entitled to (mirrors teacher_can_read_profile without recursing).
create or replace function public.list_class_roster(p_class_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert_class_owner(p_class_id);
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'student_id',   p.id,
                 'email',        p.email::text,
                 'display_name', p.display_name,
                 'joined_at',    m.joined_at
               ) order by m.joined_at
             )
      from public.class_members m
      join public.profiles p on p.id = m.student_id
      where m.class_id = p_class_id
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'email',      i.email::text,
                 'created_at', i.created_at
               ) order by i.created_at
             )
      from public.class_invites i
      where i.class_id = p_class_id
    ), '[]'::jsonb)
  );
end;
$$;

-- ── GRANTs (roster RPCs are invoked by the owner's authenticated session so
-- auth.uid() resolves to the owner; service_role may also call) ───────────────
-- Strip the default PUBLIC EXECUTE first so only the roles granted below can call
-- these SECURITY DEFINER RPCs.
revoke all on function public._assert_class_owner(uuid)                from public;
revoke all on function public.add_student_to_class(uuid, text)         from public;
revoke all on function public.remove_student_from_class(uuid, uuid)    from public;
revoke all on function public.revoke_invite(uuid, text)                from public;
revoke all on function public.list_class_roster(uuid)                  from public;

grant execute on function public._assert_class_owner(uuid)                to authenticated, service_role;
grant execute on function public.add_student_to_class(uuid, text)         to authenticated, service_role;
grant execute on function public.remove_student_from_class(uuid, uuid)    to authenticated, service_role;
grant execute on function public.revoke_invite(uuid, text)                to authenticated, service_role;
grant execute on function public.list_class_roster(uuid)                  to authenticated, service_role;

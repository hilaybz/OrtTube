-- ============================================================
-- Lifecycle primitives (spec §6.1)
--
-- SECURITY DEFINER RPCs for teacher deactivation and ownership reassignment.
--
-- Teachers own classes (classes.teacher_id) and quizzes (quizzes.author_id)
-- under ON DELETE RESTRICT, so they can NEVER be hard-deleted while they own
-- content — cascading a teacher would erase students' attempts on their quizzes
-- (spec §6.1). Instead a teacher is:
--
--   • deactivated  — deactivate_teacher(): stamps profiles.deactivated_at, which
--     the sign-in gate and every owner RLS policy (owner helpers require
--     deactivated_at IS NULL, 011/013) enforce, so a deactivated teacher retains
--     no owner access. Students still see the deactivated teacher's assigned
--     quizzes (deactivation gates the OWNER, not enrolled students — Appendix C).
--
--   • reassigned   — reassign_ownership(): moves classes.teacher_id and
--     quizzes.author_id to another ACTIVE, SAME-SCHOOL teacher (the composite FK
--     classes(teacher_id, school_id) → profiles(id, school_id) would otherwise
--     reject a cross-school move). After reassignment the original teacher owns
--     nothing and CAN be hard-deleted via /api/admin/delete-user.
--
-- Student hard-delete + behavioural anonymisation needs no RPC: deleting the
-- auth.users row cascades to profiles (ON DELETE CASCADE), which cascades
-- class_members and drives attempts.student_id / tutor_questions.student_id to
-- NULL (ON DELETE SET NULL). Done in Node via service.auth.admin.deleteUser —
-- see app/api/admin/delete-user + lib/lifecycle.ts.
--
-- Both RPCs are SECURITY DEFINER (execute as the postgres owner → bypass RLS)
-- and are EXECUTE-granted to service_role ONLY (REVOKE from PUBLIC first — a
-- definer function left PUBLIC-callable would let anon/authenticated invoke
-- privileged logic). They take a pg_advisory_xact_lock keyed on the teacher for
-- the transaction's duration, so a concurrent reassign/deactivate/delete for the
-- same teacher serialises safely under the transaction-mode pooler (§0 locking:
-- short in-DB critical section → xact-scoped advisory lock is fine).
--
-- Stable error codes (SQLSTATE surfaced as PostgREST `error.code`; mapped by
-- lib/lifecycle.ts):
--   OT404 — profile not found
--   OT400 — target profile is not a teacher
--   OT409 — reassign target is deactivated or in a different school
--   OT422 — reassign source and target are the same teacher
-- ============================================================

-- Stable bigint lock key for a teacher's lifecycle critical section.
create or replace function public.lifecycle_lock_key(p_teacher_id uuid)
returns bigint
language sql
immutable
set search_path = public
as $$
  select hashtextextended('lifecycle:' || p_teacher_id::text, 0)
$$;

revoke all on function public.lifecycle_lock_key(uuid) from public;

-- ── deactivate_teacher ───────────────────────────────────────────────────────
-- Idempotent: stamps deactivated_at once and keeps the original timestamp on
-- repeat calls. Only role/school_id are immutable (014), so writing
-- deactivated_at is allowed for every writer.
create or replace function public.deactivate_teacher(p_teacher_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role           text;
  v_deactivated_at timestamptz;
begin
  perform pg_advisory_xact_lock(public.lifecycle_lock_key(p_teacher_id));

  select role, deactivated_at
    into v_role, v_deactivated_at
  from public.profiles
  where id = p_teacher_id
  for update;

  if not found then
    raise exception 'profile % not found', p_teacher_id
      using errcode = 'OT404';
  end if;
  if v_role <> 'teacher' then
    raise exception 'profile % is not a teacher (role=%)', p_teacher_id, v_role
      using errcode = 'OT400';
  end if;

  if v_deactivated_at is null then
    update public.profiles
    set deactivated_at = now()
    where id = p_teacher_id
    returning deactivated_at into v_deactivated_at;
  end if;

  return jsonb_build_object(
    'teacher_id',     p_teacher_id,
    'deactivated_at', v_deactivated_at
  );
end;
$$;

revoke all on function public.deactivate_teacher(uuid) from public;
grant execute on function public.deactivate_teacher(uuid) to service_role;

-- ── reassign_ownership ───────────────────────────────────────────────────────
-- Moves every class + quiz owned by p_from_teacher to p_to_teacher. Guards:
-- distinct teachers, both exist, both are teachers, target is active and in the
-- same school (composite FK). Returns the counts moved.
create or replace function public.reassign_ownership(
  p_from_teacher uuid,
  p_to_teacher   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_role      text;
  v_from_school    uuid;
  v_to_role        text;
  v_to_school      uuid;
  v_to_deactivated timestamptz;
  v_classes        int;
  v_quizzes        int;
begin
  if p_from_teacher = p_to_teacher then
    raise exception 'cannot reassign ownership to the same teacher (%)', p_from_teacher
      using errcode = 'OT422';
  end if;

  -- Lock both teachers in a stable (id-sorted) order to avoid deadlocks with a
  -- concurrent reassignment running in the opposite direction.
  if p_from_teacher < p_to_teacher then
    perform pg_advisory_xact_lock(public.lifecycle_lock_key(p_from_teacher));
    perform pg_advisory_xact_lock(public.lifecycle_lock_key(p_to_teacher));
  else
    perform pg_advisory_xact_lock(public.lifecycle_lock_key(p_to_teacher));
    perform pg_advisory_xact_lock(public.lifecycle_lock_key(p_from_teacher));
  end if;

  select role, school_id
    into v_from_role, v_from_school
  from public.profiles
  where id = p_from_teacher
  for update;
  if not found then
    raise exception 'source profile % not found', p_from_teacher
      using errcode = 'OT404';
  end if;

  select role, school_id, deactivated_at
    into v_to_role, v_to_school, v_to_deactivated
  from public.profiles
  where id = p_to_teacher
  for update;
  if not found then
    raise exception 'target profile % not found', p_to_teacher
      using errcode = 'OT404';
  end if;

  if v_from_role <> 'teacher' then
    raise exception 'source profile % is not a teacher (role=%)', p_from_teacher, v_from_role
      using errcode = 'OT400';
  end if;
  if v_to_role <> 'teacher' then
    raise exception 'target profile % is not a teacher (role=%)', p_to_teacher, v_to_role
      using errcode = 'OT400';
  end if;
  if v_to_deactivated is not null then
    raise exception 'target teacher % is deactivated', p_to_teacher
      using errcode = 'OT409';
  end if;
  if v_from_school <> v_to_school then
    raise exception 'teachers are in different schools (% vs %) — composite FK would reject',
      v_from_school, v_to_school
      using errcode = 'OT409';
  end if;

  update public.classes
  set teacher_id = p_to_teacher
  where teacher_id = p_from_teacher;
  get diagnostics v_classes = row_count;

  update public.quizzes
  set author_id = p_to_teacher
  where author_id = p_from_teacher;
  get diagnostics v_quizzes = row_count;

  return jsonb_build_object(
    'from_teacher',       p_from_teacher,
    'to_teacher',         p_to_teacher,
    'classes_reassigned', v_classes,
    'quizzes_reassigned', v_quizzes
  );
end;
$$;

revoke all on function public.reassign_ownership(uuid, uuid) from public;
grant execute on function public.reassign_ownership(uuid, uuid) to service_role;

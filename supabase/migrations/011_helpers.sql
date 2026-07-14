-- ============================================================
-- SECURITY DEFINER helper functions (spec §7)
--
-- Small, STABLE helpers used inside RLS policy expressions. They are
-- SECURITY DEFINER so their internal reads bypass RLS — this is what lets a
-- policy on table A consult table B (or table A itself) without recursing back
-- into A's own policy. Each pins a fixed search_path (defence against search_path
-- hijacking) and schema-qualifies every reference.
--
-- Teacher owner helpers additionally require `deactivated_at IS NULL`, so a
-- deactivated teacher retains no owner access (spec §6.1 / §7).
-- ============================================================

-- The school of the current user (used for same-school RLS predicates).
create or replace function public.current_school_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select school_id from public.profiles where id = auth.uid()
$$;

-- Is the current user an active (non-deactivated) teacher?
create or replace function public.is_active_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'teacher'
      and p.deactivated_at is null
  )
$$;

-- Does the current user own (as an active teacher) the given class?
create or replace function public.is_teacher_of_class(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.classes c
    join public.profiles p on p.id = c.teacher_id
    where c.id = cid
      and c.teacher_id = auth.uid()
      and p.deactivated_at is null
  )
$$;

-- Is the current user a member (student) of the given class?
create or replace function public.is_member_of_class(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.class_members m
    where m.class_id = cid
      and m.student_id = auth.uid()
  )
$$;

-- May the current (active teacher) user read the given profile? True when the
-- target is a student in a class the caller owns. Used by the profiles SELECT
-- policy to avoid recursion.
create or replace function public.teacher_can_read_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.classes c
    join public.class_members m on m.class_id = c.id
    join public.profiles p on p.id = c.teacher_id
    where c.teacher_id = auth.uid()
      and m.student_id = target
      and p.deactivated_at is null
  )
$$;

-- These helpers are evaluated inside policy expressions as the querying role, so
-- that role needs EXECUTE. (service_role bypasses RLS but may still call them.)
grant execute on function public.current_school_id()               to anon, authenticated, service_role;
grant execute on function public.is_active_teacher()               to anon, authenticated, service_role;
grant execute on function public.is_teacher_of_class(uuid)         to anon, authenticated, service_role;
grant execute on function public.is_member_of_class(uuid)          to anon, authenticated, service_role;
grant execute on function public.teacher_can_read_profile(uuid)    to anon, authenticated, service_role;

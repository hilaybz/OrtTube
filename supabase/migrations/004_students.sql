-- ============================================================
-- Student accounts: students table + role-aware signup trigger
-- Run this in: Supabase dashboard → SQL Editor → New query
-- (Safe to re-run: uses if-not-exists / or-replace everywhere.)
-- ============================================================

create table if not exists public.students (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text,
  created_at   timestamptz default now() not null
);
alter table public.students enable row level security;

drop policy if exists "students_own" on public.students;
create policy "students_own" on public.students
  for all using (auth.uid() = id);

-- The blanket GRANT from initial setup only covered tables that existed
-- then — new tables need their own grants.
grant all on table public.students to anon, authenticated;

-- Route email signups by role from auth metadata.
-- Missing role = teacher, so existing teacher accounts keep working.
-- security definer + pinned search_path + schema-qualified names, because
-- this runs from the auth system's context where "students" alone may not
-- resolve.
create or replace function public.handle_new_teacher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null then
    if coalesce(new.raw_user_meta_data->>'role', 'teacher') = 'student' then
      insert into public.students (id, email, display_name)
      values (new.id, new.email, new.raw_user_meta_data->>'display_name')
      on conflict (id) do nothing;
    else
      insert into public.teachers (id, email)
      values (new.id, new.email)
      on conflict (id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

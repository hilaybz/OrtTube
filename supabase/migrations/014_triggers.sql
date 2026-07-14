-- ============================================================
-- Integrity triggers (spec §3.1, §3.2, §3.4)
--   1. profiles role/school_id immutability
--   2. invite → membership conversion on student profile insert
--   3. correctness validation (deferred constraint trigger)
-- ============================================================

-- ── 1. Immutability: role and school_id can never change ─────────────────────
-- Backs up the column-level REVOKE in 012 (which stops the client) and also
-- blocks the service-role / any writer, since role & school are immutable for
-- everyone in v1 (spec §3.1, decisions 2 & 21).
create or replace function public.enforce_profile_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    raise exception 'profiles.role is immutable' using errcode = '42501';
  end if;
  if new.school_id is distinct from old.school_id then
    raise exception 'profiles.school_id is immutable' using errcode = '42501';
  end if;
  -- deactivated_at is writable ONLY by the privileged lifecycle path (the
  -- SECURITY DEFINER deactivate_teacher runs as the function owner; direct
  -- service-role writes are also allowed). A normal API caller (authenticated/
  -- anon) must never flip it — otherwise a deactivated teacher whose session
  -- still holds a valid token could self-reactivate. The column-level REVOKE in
  -- 012 is the first line of defence; this is the belt-and-suspenders backstop.
  if new.deactivated_at is distinct from old.deactivated_at
     and current_user in ('authenticated', 'anon') then
    raise exception 'profiles.deactivated_at may only be changed by the lifecycle path'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger enforce_profile_immutability
  before update on public.profiles
  for each row execute function public.enforce_profile_immutability();

-- ── 2. Invite conversion on student profile insert ───────────────────────────
-- Replaces the legacy handle_new_teacher trigger on auth.users. Fires only for
-- students; converts matching (same-school) invites to memberships, deletes the
-- consumed invites, and is wrapped so a failure can never abort the signup
-- transaction (spec §3.2, decision 23).
create or replace function public.convert_invites_on_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'student' then
    begin
      insert into public.class_members (class_id, student_id)
      select ci.class_id, new.id
      from public.class_invites ci
      join public.classes c on c.id = ci.class_id
      where ci.email = new.email
        and c.school_id = new.school_id
      on conflict (class_id, student_id) do nothing;

      delete from public.class_invites ci
      using public.classes c
      where c.id = ci.class_id
        and ci.email = new.email
        and c.school_id = new.school_id;
    exception when others then
      -- Swallow: invite conversion must never break account creation.
      null;
    end;
  end if;
  return new;
end;
$$;

create trigger convert_invites_on_profile
  after insert on public.profiles
  for each row execute function public.convert_invites_on_profile();

-- ── 3. Correctness validation (deferred constraint trigger) ──────────────────
-- Enforces per questions.kind: single → exactly one live correct option;
-- multi → at least one. DEFERRED so a multi-statement authoring transaction can
-- be mid-edit without tripping — only the committed final state is checked.
--
-- Fires on BOTH sides:
--   • question_options INSERT/UPDATE/DELETE (covers add, edit, soft-delete of the
--     answer key, and cascade hard-deletes),
--   • questions UPDATE (covers flipping multi→single on a question that already
--     has two correct options — an options-only trigger would miss it).
-- Soft-deleted / removed questions are skipped (they needn't be gradeable).
create or replace function public.check_question_correctness()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  qid           uuid;
  q_kind        text;
  q_deleted     timestamptz;
  correct_count int;
begin
  if tg_table_name = 'question_options' then
    qid := coalesce(new.question_id, old.question_id);
  else -- questions
    qid := coalesce(new.id, old.id);
  end if;

  select kind, deleted_at into q_kind, q_deleted
  from public.questions
  where id = qid;

  -- Question gone (e.g. cascade delete) or soft-deleted → nothing to validate.
  if not found or q_deleted is not null then
    return null;
  end if;

  select count(*) into correct_count
  from public.question_options
  where question_id = qid
    and is_correct = true
    and deleted_at is null;

  if q_kind = 'single' and correct_count <> 1 then
    raise exception
      'single-choice question % must have exactly one correct option (found %)',
      qid, correct_count
      using errcode = '23514';
  elsif q_kind = 'multi' and correct_count < 1 then
    raise exception
      'multi-select question % must have at least one correct option',
      qid
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger check_question_correctness_options
  after insert or update or delete on public.question_options
  deferrable initially deferred
  for each row execute function public.check_question_correctness();

create constraint trigger check_question_correctness_kind
  after update on public.questions
  deferrable initially deferred
  for each row execute function public.check_question_correctness();

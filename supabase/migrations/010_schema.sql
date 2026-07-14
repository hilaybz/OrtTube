-- ============================================================
-- OrtTube v2 schema (spec §3)
--
-- Clean v2 baseline. Existing data is dev-only (spec §12), so this migration
-- first tears down the legacy v1 objects created by 001–004 (idempotent DROPs,
-- so it applies whether or not those migrations are still present), then builds
-- the entire redesigned schema.
--
-- Companion migrations:
--   011_helpers.sql  — SECURITY DEFINER helpers used by RLS
--   012_grants.sql   — explicit GRANTs to anon/authenticated/service_role
--   013_rls.sql      — RLS enable + all policies (spec §7)
--   014_triggers.sql — immutability / invite-conversion / correctness triggers
--   015_indexes.sql  — indexes (spec §3.7)
-- ============================================================

-- ── Legacy teardown (v1 → v2 cutover) ────────────────────────────────────────
-- The invite-conversion trigger (014) replaces the old handle_new_teacher
-- trigger on auth.users; drop it and every v1 table.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_teacher() cascade;

drop table if exists public.student_events cascade;
drop table if exists public.student_answers cascade;
drop table if exists public.student_sessions cascade;
drop table if exists public.quiz_questions cascade;
drop table if exists public.quiz_checkpoints cascade;
drop table if exists public.youtube_transcripts cascade;
drop table if exists public.videos cascade;
drop table if exists public.students cascade;
drop table if exists public.teachers cascade;

-- ── Extensions ───────────────────────────────────────────────────────────────
-- citext for case-insensitive email (installed into public so the type and its
-- operators resolve under the default/public search_path used by both the
-- migration DDL and the SECURITY DEFINER helpers).
create extension if not exists citext;

-- ============================================================
-- 3.1 Identity
-- ============================================================

create table public.schools (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  role               text not null check (role in ('teacher','student')),           -- immutable (014)
  school_id          uuid not null references public.schools(id),                    -- immutable (014)
  email              citext not null unique,
  display_name       text,
  preferred_language text check (preferred_language in ('he','ar','en')),            -- null = fall back to class language
  deactivated_at     timestamptz,                                                    -- teachers are deactivated, not deleted
  created_at         timestamptz not null default now(),
  unique (id, role),       -- FK target for role-checked composite FKs
  unique (id, school_id)   -- FK target for school-checked composite FKs
);

-- ============================================================
-- 3.2 Classes, membership, invites
-- ============================================================

create table public.classes (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid not null,
  teacher_role text not null default 'teacher' check (teacher_role = 'teacher'),
  school_id    uuid not null,
  name         text not null,
  language     text not null default 'he' check (language in ('he','ar','en')),
  created_at   timestamptz not null default now(),
  foreign key (teacher_id, teacher_role) references public.profiles(id, role)      on delete restrict,
  foreign key (teacher_id, school_id)    references public.profiles(id, school_id)
);

create table public.class_members (
  class_id     uuid not null references public.classes(id) on delete cascade,
  student_id   uuid not null,
  student_role text not null default 'student' check (student_role = 'student'),
  joined_at    timestamptz not null default now(),
  primary key (class_id, student_id),
  foreign key (student_id, student_role) references public.profiles(id, role) on delete cascade
);

create table public.class_invites (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references public.classes(id) on delete cascade,
  email      citext not null,
  created_at timestamptz not null default now(),
  unique (class_id, email)
);

-- ============================================================
-- 3.3 Videos (canonical, shared, ownerless)
-- ============================================================

create table public.videos (
  id                          uuid primary key default gen_random_uuid(),
  youtube_video_id            text not null unique,           -- dedup key
  title                       text,
  duration_seconds            int,
  transcript_status           text not null default 'pending'
                                check (transcript_status in ('pending','ready','unavailable')),
  fetched_at                  timestamptz,
  transcript_fetch_started_at timestamptz,                    -- single-flight claim marker (§3.3)
  created_at                  timestamptz not null default now()
);

-- ============================================================
-- 3.4 Quizzes, questions, options, translations
-- ============================================================

create table public.quizzes (
  id             uuid primary key default gen_random_uuid(),
  author_id      uuid not null references public.profiles(id) on delete restrict,   -- teacher OR (future) student
  video_id       uuid not null references public.videos(id)   on delete restrict,
  school_id      uuid not null references public.schools(id),
  title          text,
  base_language  text not null default 'he' check (base_language in ('he','ar','en')),
  visibility     text not null default 'private' check (visibility in ('private','shared')),
  cloned_from_id uuid references public.quizzes(id) on delete set null,
  deleted_at     timestamptz,                                 -- soft delete
  created_at     timestamptz not null default now()
);

create table public.questions (
  id               uuid primary key default gen_random_uuid(),
  quiz_id          uuid not null references public.quizzes(id) on delete cascade,
  kind             text not null default 'single' check (kind in ('single','multi')),
  position_seconds int not null,
  order_index      int not null default 0,
  deleted_at       timestamptz                                -- soft delete
);

create table public.question_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  is_correct  boolean not null default false,                 -- language-independent answer key
  order_index int not null default 0,
  deleted_at  timestamptz                                     -- soft delete (preserves answer history)
);

create table public.question_translations (
  question_id uuid not null references public.questions(id) on delete cascade,
  language    text not null check (language in ('he','ar','en')),
  prompt      text not null,
  explanation text,
  source      text not null default 'translated'
                check (source in ('authored','generated','translated')),
  primary key (question_id, language)
);

create table public.option_translations (
  option_id uuid not null references public.question_options(id) on delete cascade,
  language  text not null check (language in ('he','ar','en')),
  text      text not null,
  primary key (option_id, language)
);

-- ============================================================
-- 3.5 Assignment, attempts, answers
-- ============================================================

create table public.class_quizzes (
  class_id     uuid not null references public.classes(id) on delete cascade,
  quiz_id      uuid not null references public.quizzes(id) on delete cascade,
  tutor_mode   text not null default 'hints' check (tutor_mode in ('off','hints','full')),
  max_attempts int default 1,                                 -- null = unlimited
  assigned_at  timestamptz not null default now(),
  primary key (class_id, quiz_id)
);

create table public.attempts (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid references public.profiles(id) on delete set null,   -- NULL = anonymized
  class_id      uuid not null references public.classes(id) on delete cascade,
  quiz_id       uuid not null references public.quizzes(id) on delete cascade,
  attempt_no    int not null default 1,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  num_correct   int,
  num_questions int,
  unique (student_id, class_id, quiz_id, attempt_no)          -- NULLs distinct: anonymized rows never collide
);

-- Frozen question set for an attempt (start snapshot). A count in
-- attempts.num_questions cannot answer snapshot membership, and questions has no
-- created_at to reconstruct it, so it must be materialized.
create table public.attempt_questions (
  attempt_id  uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  order_index int,
  primary key (attempt_id, question_id)
);

create table public.answers (
  id          uuid primary key default gen_random_uuid(),
  attempt_id  uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  was_correct boolean not null,                               -- snapshot at answer time
  answered_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create table public.answer_selections (
  answer_id uuid not null references public.answers(id) on delete cascade,
  option_id uuid not null references public.question_options(id) on delete cascade,
  primary key (answer_id, option_id)
);

-- ============================================================
-- 3.6 AI tutor questions (analytics)
-- ============================================================

create table public.tutor_questions (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid references public.profiles(id)  on delete set null,   -- NULL = anonymized
  class_id         uuid not null references public.classes(id)  on delete cascade,
  quiz_id          uuid not null references public.quizzes(id)  on delete cascade,
  video_id         uuid not null references public.videos(id)   on delete restrict,
  attempt_id       uuid references public.attempts(id)  on delete set null,   -- only if asked mid-attempt
  question_id      uuid references public.questions(id) on delete set null,   -- the on-screen question, if any
  position_seconds int,
  prompt           text not null,
  ai_response      text,
  created_at       timestamptz not null default now()
);

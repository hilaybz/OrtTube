-- ============================================================
-- Translation single-flight claim table + RPCs (spec §3.4, plan §0)
--
-- The multilingual content layer (question_translations / option_translations)
-- is filled lazily by translating from a quiz's base_language. Translation is
-- LONG external I/O (Anthropic), so per §0 we must NOT hold a DB lock across it.
-- Instead we use a per-(quiz, language) CLAIM MARKER: a conditional UPSERT stamps
-- `started_at`; the winner does the work, losers skip and let the winner fill
-- (the student read falls back to base_language until the rows exist).
--
-- `ensureTranslation` (lib/quiz.ts) drives these RPCs. Companion migration:
--   041_quiz_authoring_rpcs.sql — owner-only authoring RPCs.
-- ============================================================

create table if not exists public.translation_jobs (
  quiz_id      uuid not null references public.quizzes(id) on delete cascade,
  language     text not null check (language in ('he','ar','en')),
  started_at   timestamptz,                 -- claim marker: set while a filler is running
  completed_at timestamptz,                 -- last successful fill (descriptive)
  primary key (quiz_id, language)
);

-- ── GRANTs (never rely on implicit privileges) ───────────────────────────────
-- service_role bypasses RLS but still needs table privileges; ensureTranslation
-- runs with the service client. authenticated gets SELECT so an owner / attempts read
-- path may inspect job state; all writes go through the SECURITY DEFINER RPCs.
grant all    on public.translation_jobs to service_role;
grant select on public.translation_jobs to authenticated;

-- RLS: enable and add no permissive policy for authenticated (SELECT is a no-op
-- for non-owners; the RPCs are SECURITY DEFINER so they bypass RLS). service_role
-- bypasses RLS entirely.
alter table public.translation_jobs enable row level security;

-- Quiz owners may read their own quiz's job rows (diagnostics / eager UI).
create policy translation_jobs_owner_select on public.translation_jobs
  for select to authenticated
  using (
    exists (
      select 1 from public.quizzes q
      where q.id = translation_jobs.quiz_id
        and q.author_id = auth.uid()
    )
  );

-- ── claim_translation_job ─────────────────────────────────────────────────────
-- Atomic single-flight claim under the transaction pooler (no advisory lock).
-- Returns TRUE if the caller won the claim (no active claim, or the prior claim
-- is stale beyond the TTL); FALSE if another filler currently holds it.
create or replace function public.claim_translation_job(
  p_quiz_id     uuid,
  p_language    text,
  p_ttl_seconds int default 120
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_won boolean;
begin
  if p_language not in ('he','ar','en') then
    raise exception 'invalid_language' using errcode = 'P0001';
  end if;

  insert into public.translation_jobs (quiz_id, language, started_at)
  values (p_quiz_id, p_language, now())
  on conflict (quiz_id, language) do update
    set started_at = now()
    where translation_jobs.started_at is null
       or translation_jobs.started_at < now() - make_interval(secs => p_ttl_seconds)
  returning true into v_won;

  return coalesce(v_won, false);
end;
$$;

-- ── release_translation_job ───────────────────────────────────────────────────
-- Clears the claim marker and stamps completion. Safe to call even if the row
-- was never claimed (no-op).
create or replace function public.release_translation_job(
  p_quiz_id  uuid,
  p_language text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.translation_jobs
    set started_at = null,
        completed_at = now()
    where quiz_id = p_quiz_id
      and language = p_language;
end;
$$;

grant execute on function public.claim_translation_job(uuid, text, int) to authenticated, service_role;
grant execute on function public.release_translation_job(uuid, text)     to authenticated, service_role;

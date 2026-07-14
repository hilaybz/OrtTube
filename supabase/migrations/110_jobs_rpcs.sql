-- ============================================================
-- Scheduled-job support RPCs (spec §6.1, §3.3)
-- Range 110–119 (scheduled-job support SQL).
--
-- Three SECURITY DEFINER functions backing the CRON_SECRET-guarded job
-- endpoints under app/api/jobs/*. They are SECURITY DEFINER (execute as the
-- postgres owner) so the maintenance logic runs with a stable, elevated context
-- regardless of what table/schema grants service_role happens to hold — in
-- particular list_orphan_auth_users must read auth.users, which is outside the
-- public schema. EXECUTE is granted to service_role ONLY (REVOKE from PUBLIC
-- first — a definer function left PUBLIC-callable would let anon/authenticated
-- invoke destructive maintenance).
--
-- Why RPCs (not direct PostgREST deletes from the service client): the orphan
-- checks are anti-joins that must be evaluated atomically with the DELETE. A
-- read-then-delete from the app layer would race a concurrent quiz insert
-- (quiz authoring creates video + first quiz in ONE transaction, §3.3) and could delete a
-- video that just gained a quiz. A single `DELETE … WHERE NOT EXISTS (…)`
-- statement is race-free.
--
-- Windows are passed as plain integers (days / minutes) rather than an interval
-- text so PostgREST coercion is unambiguous; the interval is built in-SQL with
-- make_interval.
--
-- Stable error codes surface as SQLSTATE (PostgREST `error.code`); the route
-- handlers translate any raise into a 500 job error envelope:
--   OT400 — invalid window argument
-- ============================================================

-- ── purge_soft_deleted_quizzes ───────────────────────────────────────────────
-- Content purge (spec §6.1). Hard-DELETEs quizzes whose
-- deleted_at is older than the retention window; the ON DELETE CASCADE chain
-- from quizzes removes their questions/options/translations, class_quizzes,
-- attempts/attempt_questions/answers/answer_selections and tutor_questions.
--
-- QUIZ GRANULARITY ONLY: this deletes rows from `quizzes` alone, so a lone
-- soft-deleted question (deleted_at set on a `questions` row inside a live quiz)
-- is never purged on its own — it is removed only when its whole quiz is purged
-- (§6.1). A single set-based statement is atomic, so no advisory lock is needed;
-- a concurrent invocation is at worst a harmless no-op on already-gone rows.
create or replace function public.purge_soft_deleted_quizzes(p_retention_days int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  if p_retention_days is null or p_retention_days < 0 then
    raise exception 'purge_soft_deleted_quizzes: p_retention_days must be a non-negative integer (got %)', p_retention_days
      using errcode = 'OT400';
  end if;

  with purged as (
    delete from public.quizzes
    where deleted_at is not null
      and deleted_at < now() - make_interval(days => p_retention_days)
    returning id
  )
  select count(*)::int into v_deleted from purged;

  return jsonb_build_object('deleted', v_deleted);
end;
$$;

revoke all on function public.purge_soft_deleted_quizzes(int) from public;
grant execute on function public.purge_soft_deleted_quizzes(int) to service_role;

-- ── gc_orphan_videos ─────────────────────────────────────────────────────────
-- Orphan-video GC (spec §3.3). Deletes canonical `videos` rows
-- that (a) are older than a short grace window (videos.created_at) and (b) have
-- NO referencing quiz. The grace window is what keeps GC from racing the
-- atomic video+first-quiz create (§3.3): a just-created video is younger than
-- the window even in the instant before its first quiz commits.
--
-- Both quizzes.video_id and tutor_questions.video_id are ON DELETE RESTRICT, so
-- BOTH are excluded via anti-join — otherwise the DELETE could raise a raw FK
-- error on a video still referenced by a tutor_questions row whose quiz points
-- at a different video. (A soft-deleted-but-not-yet-purged quiz still references
-- its video, so GC only removes a video after purge has taken its last quiz —
-- run purge before gc.)
--
-- Returns the deleted rows (id + youtube_video_id) so the job can best-effort
-- delete each video's Storage transcript object (`<youtube_video_id>.json`).
create or replace function public.gc_orphan_videos(p_grace_minutes int)
returns table (id uuid, youtube_video_id text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_grace_minutes is null or p_grace_minutes < 0 then
    raise exception 'gc_orphan_videos: p_grace_minutes must be a non-negative integer (got %)', p_grace_minutes
      using errcode = 'OT400';
  end if;

  return query
    delete from public.videos v
    where v.created_at < now() - make_interval(mins => p_grace_minutes)
      and not exists (select 1 from public.quizzes q         where q.video_id = v.id)
      and not exists (select 1 from public.tutor_questions t where t.video_id = v.id)
    returning v.id, v.youtube_video_id;
end;
$$;

revoke all on function public.gc_orphan_videos(int) from public;
grant execute on function public.gc_orphan_videos(int) to service_role;

-- ── list_orphan_auth_users ───────────────────────────────────────────────────
-- Orphan auth.users reconciliation (spec §4 decision 23). Returns
-- auth.users rows that have NO matching public.profiles row and are older than N
-- minutes. The signup try/catch deletes the auth user on caught failures, but
-- process death (a serverless timeout/crash between createUser and the profile
-- insert) can still strand an auth.users row with no profile — this is the
-- safety net. The age floor avoids racing an in-flight signup that has created
-- the auth user but not yet inserted its profile (the route clamps to >= 5 min).
--
-- Returns candidates only; the job deletes each via GoTrue's admin API
-- (service.auth.admin.deleteUser) so identities/sessions are torn down the
-- blessed way and per-user failures are reported individually. SECURITY DEFINER
-- is required to read the auth schema.
create or replace function public.list_orphan_auth_users(p_older_than_minutes int)
returns table (id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_older_than_minutes is null or p_older_than_minutes < 0 then
    raise exception 'list_orphan_auth_users: p_older_than_minutes must be a non-negative integer (got %)', p_older_than_minutes
      using errcode = 'OT400';
  end if;

  return query
    select u.id, u.created_at
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p.id is null
      and u.created_at < now() - make_interval(mins => p_older_than_minutes);
end;
$$;

revoke all on function public.list_orphan_auth_users(int) from public;
grant execute on function public.list_orphan_auth_users(int) to service_role;

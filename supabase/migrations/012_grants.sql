-- ============================================================
-- Explicit privilege GRANTs (spec §7)
--
-- CRITICAL: on a fresh local Supabase the API roles (anon/authenticated/
-- service_role) receive only TRUNCATE/REFERENCES/TRIGGER on new tables by
-- default (auto_expose_new_tables is off, matching the cloud default), so every
-- REST/RPC call fails with 42501 unless privileges are granted explicitly. We
-- grant privileges here; RLS (013) then restricts which *rows* each role sees.
--
-- Grant strategy:
--   • service_role  → ALL on every table (it bypasses RLS; still needs privileges).
--   • authenticated → the DML that RLS narrows. Tables whose cross-entity
--       integrity is enforced by a SECURITY DEFINER RPC rather than a composite
--       FK (class_members: cross-school; class_quizzes: same-school) get SELECT
--       only — their writes go through the class RPCs, so direct client writes
--       (which would bypass those checks) are withheld. Behavioural tables
--       (attempts/answers/… /tutor_questions) get SELECT only — writes go through
--       the grading / ask RPCs.
--   • anon          → nothing. There is no pre-auth table surface in v1 (student
--       signup and teacher seeding run through the service-role path).
-- ============================================================

-- ── service_role: full DML on everything ─────────────────────────────────────
grant all on all tables in schema public to service_role;

-- ── schools / videos: authenticated read; writes are service-role only ────────
grant select on public.schools to authenticated;
grant select on public.videos  to authenticated;

-- ── profiles: read (own + teacher-of) and self-update; role/school immutable ──
grant select, update on public.profiles to authenticated;
-- Belt-and-suspenders with the 014 immutability trigger: strip UPDATE on the
-- immutable columns so the client cannot even attempt to change them.
--   • role / school_id  — immutable for everyone in v1.
--   • deactivated_at    — a deactivated teacher must NOT be able to self-reactivate
--     (their session may still hold a valid token); only the SECURITY DEFINER /
--     service-role lifecycle path (deactivate_teacher) may write it.
revoke update (role, school_id, deactivated_at) on public.profiles from authenticated;

-- ── classes: owner full DML (composite FKs keep school/role consistent) ───────
grant select, insert, update, delete on public.classes to authenticated;

-- ── class_members / class_invites / class_quizzes: SELECT only ────────────────
-- Writes go through the class SECURITY DEFINER RPCs so their cross-school / same-school
-- guards can't be bypassed by a direct owner-RLS write.
grant select on public.class_members to authenticated;
grant select on public.class_invites to authenticated;
grant select on public.class_quizzes to authenticated;

-- ── quizzes / questions / options / translations: owner SELECT/INSERT/UPDATE ──
-- NOTE: no DELETE. A hard DELETE of a quiz would cascade-destroy student
-- attempts/answers (behavioural history). Removal is a SOFT delete only
-- (soft_delete_quiz sets deleted_at); the actual purge of long-soft-deleted
-- content runs through the service-role purge job (110). UPDATE stays for
-- soft-delete + authoring edits.
grant select, insert, update on public.quizzes               to authenticated;
grant select, insert, update on public.questions             to authenticated;
grant select, insert, update on public.question_options      to authenticated;
grant select, insert, update on public.question_translations to authenticated;
grant select, insert, update on public.option_translations   to authenticated;

-- Belt-and-suspenders: even though the FOR ALL owner policies (013) would permit
-- a DELETE at the RLS layer, withhold the table privilege so a direct client
-- DELETE is refused (42501) before RLS is ever consulted.
revoke delete on public.quizzes               from anon, authenticated;
revoke delete on public.questions             from anon, authenticated;
revoke delete on public.question_options      from anon, authenticated;
revoke delete on public.question_translations from anon, authenticated;
revoke delete on public.option_translations   from anon, authenticated;

-- ── behavioural tables: SELECT only (writes via attempts / tutor RPCs) ────────
grant select on public.attempts          to authenticated;
grant select on public.attempt_questions to authenticated;
grant select on public.tutor_questions   to authenticated;

-- answers / answer_selections carry the per-question correctness snapshot
-- (was_correct) — the answer key. Students must NEVER read these directly (a
-- direct PostgREST select would leak which questions they got right/wrong and,
-- combined with answer_selections, the correct options). They receive results
-- ONLY through get_attempt_review (SECURITY DEFINER, gated by the reveal rule);
-- owner/teacher analytics read them through the SD analytics RPCs (090–093),
-- which run as the function owner and so do not need this table grant. We revoke
-- explicitly (belt-and-suspenders) so no accidental future grant re-exposes them.
revoke select on public.answers           from anon, authenticated;
revoke select on public.answer_selections from anon, authenticated;

-- ── Sequences ─────────────────────────────────────────────────────────────────
-- Every PK is a uuid (gen_random_uuid) or a composite of existing columns, so no
-- sequences are created by this schema. Grant USAGE on any that exist now/later
-- anyway, so authenticated INSERTs never trip a sequence 42501.
grant usage, select on all sequences in schema public to authenticated, service_role;

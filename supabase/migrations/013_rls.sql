-- ============================================================
-- Row-Level Security (spec §7)
--
-- RLS is enabled on every table. Policies are scoped `TO authenticated`
-- (service_role bypasses RLS; anon has no table grants so never reaches a
-- policy). Owner (teacher) policies go through the SECURITY DEFINER helpers in
-- 011, which fold in the deactivation gate (`deactivated_at IS NULL`).
--
-- Key invariants enforced here:
--   • Students have NO direct SELECT on question_options (answer key) — they read
--     answer-free content through the attempts RPC.
--   • "shared" reads are teacher-only (is_active_teacher()) so a same-school
--     *student* can never satisfy a shared predicate and leak is_correct.
--   • Behavioural rows are read by their student (own) or the quiz owner only.
-- ============================================================

alter table public.schools               enable row level security;
alter table public.profiles              enable row level security;
alter table public.classes               enable row level security;
alter table public.class_members         enable row level security;
alter table public.class_invites         enable row level security;
alter table public.videos                enable row level security;
alter table public.quizzes               enable row level security;
alter table public.questions             enable row level security;
alter table public.question_options      enable row level security;
alter table public.question_translations enable row level security;
alter table public.option_translations   enable row level security;
alter table public.class_quizzes         enable row level security;
alter table public.attempts              enable row level security;
alter table public.attempt_questions     enable row level security;
alter table public.answers               enable row level security;
alter table public.answer_selections     enable row level security;
alter table public.tutor_questions       enable row level security;

-- ── schools ──────────────────────────────────────────────────────────────────
-- Any authenticated user may read schools; writes are service-role only.
create policy schools_read on public.schools
  for select to authenticated using (true);

-- ── videos ───────────────────────────────────────────────────────────────────
-- Any authenticated user may read the shared video catalog; writes service-role.
create policy videos_read on public.videos
  for select to authenticated using (true);

-- ── profiles ─────────────────────────────────────────────────────────────────
-- Read own row, or (as an owning active teacher) a student's row in your class.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.teacher_can_read_profile(id));

-- Self-update only. role/school_id are also column-REVOKE'd (012) and blocked by
-- the immutability trigger (014); this policy governs which *row* may be updated.
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- (No INSERT policy: profiles are created by the service-role signup path.)

-- ── classes ──────────────────────────────────────────────────────────────────
-- Direct, non-self-referential predicate (does NOT re-query public.classes): this
-- is what lets `INSERT … RETURNING` (createClass) pass the SELECT check under the
-- statement snapshot, where a STABLE SECURITY DEFINER re-query of public.classes
-- cannot yet see the just-inserted row. The deactivation gate is preserved via
-- is_active_teacher() (which reads only public.profiles), so a deactivated teacher
-- still retains no owner read access (spec §7).
create policy classes_owner_select on public.classes
  for select to authenticated
  using (teacher_id = auth.uid() and public.is_active_teacher());

create policy classes_member_select on public.classes
  for select to authenticated using (public.is_member_of_class(id));

create policy classes_owner_insert on public.classes
  for insert to authenticated
  with check (
    teacher_id = auth.uid()
    and public.is_active_teacher()
    and school_id = public.current_school_id()
  );

create policy classes_owner_update on public.classes
  for update to authenticated
  using (public.is_teacher_of_class(id))
  with check (teacher_id = auth.uid());

create policy classes_owner_delete on public.classes
  for delete to authenticated using (public.is_teacher_of_class(id));

-- ── class_members (SELECT only; writes via class-roster RPC) ─────────────────
create policy class_members_owner_select on public.class_members
  for select to authenticated using (public.is_teacher_of_class(class_id));

create policy class_members_student_select on public.class_members
  for select to authenticated using (student_id = auth.uid());

-- ── class_invites (owner only) ───────────────────────────────────────────────
create policy class_invites_owner_select on public.class_invites
  for select to authenticated using (public.is_teacher_of_class(class_id));

-- ── class_quizzes (owner only; SELECT — writes via class RPC) ────────────────
create policy class_quizzes_owner_select on public.class_quizzes
  for select to authenticated using (public.is_teacher_of_class(class_id));

-- ── quizzes ──────────────────────────────────────────────────────────────────
-- Owner (author, active teacher) full access; other active teachers in the same
-- school may READ a shared, non-deleted quiz. Students have no direct access.
create policy quizzes_owner_all on public.quizzes
  for all to authenticated
  using (author_id = auth.uid() and public.is_active_teacher())
  with check (
    author_id = auth.uid()
    and public.is_active_teacher()
    and school_id = public.current_school_id()
  );

create policy quizzes_shared_select on public.quizzes
  for select to authenticated
  using (
    public.is_active_teacher()
    and visibility = 'shared'
    and deleted_at is null
    and school_id = public.current_school_id()
  );

-- ── questions ────────────────────────────────────────────────────────────────
-- Visibility follows the parent quiz (the sub-select respects quizzes RLS):
-- owner writes/reads; shared-same-school teachers read.
create policy questions_owner_all on public.questions
  for all to authenticated
  using (
    exists (select 1 from public.quizzes q
            where q.id = quiz_id and q.author_id = auth.uid())
  )
  with check (
    exists (select 1 from public.quizzes q
            where q.id = quiz_id and q.author_id = auth.uid())
  );

create policy questions_shared_select on public.questions
  for select to authenticated
  using (
    public.is_active_teacher()
    and exists (select 1 from public.quizzes q
                where q.id = quiz_id
                  and q.visibility = 'shared'
                  and q.deleted_at is null
                  and q.school_id = public.current_school_id())
  );

-- ── question_options (NO student SELECT — the answer key) ─────────────────────
create policy question_options_owner_all on public.question_options
  for all to authenticated
  using (
    exists (select 1 from public.questions qn
            join public.quizzes q on q.id = qn.quiz_id
            where qn.id = question_id and q.author_id = auth.uid())
  )
  with check (
    exists (select 1 from public.questions qn
            join public.quizzes q on q.id = qn.quiz_id
            where qn.id = question_id and q.author_id = auth.uid())
  );

create policy question_options_shared_select on public.question_options
  for select to authenticated
  using (
    public.is_active_teacher()
    and exists (select 1 from public.questions qn
                join public.quizzes q on q.id = qn.quiz_id
                where qn.id = question_id
                  and q.visibility = 'shared'
                  and q.deleted_at is null
                  and q.school_id = public.current_school_id())
  );

-- ── question_translations ────────────────────────────────────────────────────
create policy question_translations_owner_all on public.question_translations
  for all to authenticated
  using (
    exists (select 1 from public.questions qn
            join public.quizzes q on q.id = qn.quiz_id
            where qn.id = question_id and q.author_id = auth.uid())
  )
  with check (
    exists (select 1 from public.questions qn
            join public.quizzes q on q.id = qn.quiz_id
            where qn.id = question_id and q.author_id = auth.uid())
  );

create policy question_translations_shared_select on public.question_translations
  for select to authenticated
  using (
    public.is_active_teacher()
    and exists (select 1 from public.questions qn
                join public.quizzes q on q.id = qn.quiz_id
                where qn.id = question_id
                  and q.visibility = 'shared'
                  and q.deleted_at is null
                  and q.school_id = public.current_school_id())
  );

-- ── option_translations ──────────────────────────────────────────────────────
create policy option_translations_owner_all on public.option_translations
  for all to authenticated
  using (
    exists (select 1 from public.question_options o
            join public.questions qn on qn.id = o.question_id
            join public.quizzes q on q.id = qn.quiz_id
            where o.id = option_id and q.author_id = auth.uid())
  )
  with check (
    exists (select 1 from public.question_options o
            join public.questions qn on qn.id = o.question_id
            join public.quizzes q on q.id = qn.quiz_id
            where o.id = option_id and q.author_id = auth.uid())
  );

create policy option_translations_shared_select on public.option_translations
  for select to authenticated
  using (
    public.is_active_teacher()
    and exists (select 1 from public.question_options o
                join public.questions qn on qn.id = o.question_id
                join public.quizzes q on q.id = qn.quiz_id
                where o.id = option_id
                  and q.visibility = 'shared'
                  and q.deleted_at is null
                  and q.school_id = public.current_school_id())
  );

-- ── attempts (student reads own; quiz owner reads for analytics) ──────────────
create policy attempts_student_select on public.attempts
  for select to authenticated using (student_id = auth.uid());

create policy attempts_owner_select on public.attempts
  for select to authenticated
  using (
    public.is_active_teacher()
    and exists (select 1 from public.quizzes q
                where q.id = quiz_id and q.author_id = auth.uid())
  );

-- ── attempt_questions ────────────────────────────────────────────────────────
create policy attempt_questions_student_select on public.attempt_questions
  for select to authenticated
  using (
    exists (select 1 from public.attempts a
            where a.id = attempt_id and a.student_id = auth.uid())
  );

create policy attempt_questions_owner_select on public.attempt_questions
  for select to authenticated
  using (
    public.is_active_teacher()
    and exists (select 1 from public.attempts a
                join public.quizzes q on q.id = a.quiz_id
                where a.id = attempt_id and q.author_id = auth.uid())
  );

-- ── answers ──────────────────────────────────────────────────────────────────
-- NO answers_student_select policy: a student must never read was_correct (the
-- per-question answer key) directly. Results are delivered only via
-- get_attempt_review (SECURITY DEFINER), gated by the reveal rule. The table
-- grant is also revoked (012), so authenticated has no direct read surface here.
create policy answers_owner_select on public.answers
  for select to authenticated
  using (
    public.is_active_teacher()
    and exists (select 1 from public.attempts a
                join public.quizzes q on q.id = a.quiz_id
                where a.id = attempt_id and q.author_id = auth.uid())
  );

-- ── answer_selections ────────────────────────────────────────────────────────
-- NO answer_selections_student_select policy: paired with answers this would
-- reveal the correct options. Students receive their selections only through
-- get_attempt_review once the reveal rule is satisfied. Table grant revoked (012).
create policy answer_selections_owner_select on public.answer_selections
  for select to authenticated
  using (
    public.is_active_teacher()
    and exists (select 1 from public.answers an
                join public.attempts a on a.id = an.attempt_id
                join public.quizzes q on q.id = a.quiz_id
                where an.id = answer_id and q.author_id = auth.uid())
  );

-- ── tutor_questions (student reads own; quiz owner reads for analytics) ───────
create policy tutor_questions_student_select on public.tutor_questions
  for select to authenticated using (student_id = auth.uid());

create policy tutor_questions_owner_select on public.tutor_questions
  for select to authenticated
  using (
    public.is_active_teacher()
    and exists (select 1 from public.quizzes q
                where q.id = quiz_id and q.author_id = auth.uid())
  );

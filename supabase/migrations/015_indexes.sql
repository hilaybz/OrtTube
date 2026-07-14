-- ============================================================
-- Indexes (spec §3.7)
--
-- Covers: every FK used in filters/joins that isn't already the leading column
-- of a PK/UNIQUE index; the analytics/browse paths; and partial soft-delete
-- indexes for hot read paths (deleted_at IS NULL) and the purge job
-- (deleted_at IS NOT NULL).
--
-- Already indexed and therefore omitted: videos.youtube_video_id (UNIQUE),
-- profiles.email (UNIQUE), and any FK that is the leading column of a composite
-- PK (class_invites.class_id, class_quizzes.class_id, attempts...pk, answers by
-- attempt_id, answer_selections by answer_id, *_translations by their id).
-- ============================================================

-- ── Identity / classes ───────────────────────────────────────────────────────
create index idx_profiles_school            on public.profiles(school_id);
create index idx_classes_teacher            on public.classes(teacher_id);
create index idx_classes_school             on public.classes(school_id);
create index idx_class_members_student      on public.class_members(student_id);       -- reverse composite PK
create index idx_class_invites_email        on public.class_invites(email);

-- ── Quizzes / questions / options ────────────────────────────────────────────
create index idx_quizzes_author             on public.quizzes(author_id);
create index idx_quizzes_video              on public.quizzes(video_id);
create index idx_quizzes_cloned_from        on public.quizzes(cloned_from_id);
create index idx_quizzes_school_visibility  on public.quizzes(school_id, visibility)
                                              where deleted_at is null;                -- shared browsing (hot)
create index idx_quizzes_deleted            on public.quizzes(deleted_at)
                                              where deleted_at is not null;            -- purge job

create index idx_questions_quiz             on public.questions(quiz_id);
create index idx_questions_quiz_live        on public.questions(quiz_id)
                                              where deleted_at is null;                -- student/read path (hot)
create index idx_questions_deleted          on public.questions(deleted_at)
                                              where deleted_at is not null;            -- purge job

create index idx_question_options_question      on public.question_options(question_id);
create index idx_question_options_question_live on public.question_options(question_id)
                                                  where deleted_at is null;            -- read path (hot)
create index idx_question_options_deleted       on public.question_options(deleted_at)
                                                  where deleted_at is not null;        -- purge job

-- ── Assignment / attempts / answers ──────────────────────────────────────────
create index idx_class_quizzes_quiz         on public.class_quizzes(quiz_id);          -- reverse composite PK
create index idx_attempts_student           on public.attempts(student_id);
create index idx_attempts_class             on public.attempts(class_id);
create index idx_attempts_quiz_completed    on public.attempts(quiz_id, completed_at); -- analytics
create index idx_attempt_questions_question on public.attempt_questions(question_id);   -- reverse composite PK
create index idx_answers_question           on public.answers(question_id);
create index idx_answer_selections_option   on public.answer_selections(option_id);     -- distractor stats

-- ── Tutor questions (analytics FKs) ──────────────────────────────────────────
create index idx_tutor_questions_quiz       on public.tutor_questions(quiz_id);
create index idx_tutor_questions_class      on public.tutor_questions(class_id);
create index idx_tutor_questions_student    on public.tutor_questions(student_id);
create index idx_tutor_questions_video      on public.tutor_questions(video_id);
create index idx_tutor_questions_attempt    on public.tutor_questions(attempt_id);
create index idx_tutor_questions_question   on public.tutor_questions(question_id);

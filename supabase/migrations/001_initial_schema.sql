-- ============================================================
-- OrtTube initial schema
-- Run this in: Supabase dashboard → SQL Editor → New query
-- ============================================================

-- ── Teachers ─────────────────────────────────────────────────
create table teachers (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text,
  created_at   timestamptz default now() not null
);
alter table teachers enable row level security;
create policy "teachers_own" on teachers
  for all using (auth.uid() = id);

-- Auto-create teacher row on email sign-up (not for anonymous sign-ins)
create or replace function handle_new_teacher()
returns trigger language plpgsql security definer as $$
begin
  if new.email is not null then
    insert into teachers (id, email)
    values (new.id, new.email)
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_teacher();


-- ── Videos ───────────────────────────────────────────────────
create table videos (
  id                 uuid primary key default gen_random_uuid(),
  teacher_id         uuid not null references teachers(id) on delete cascade,
  youtube_video_id   text not null,
  title              text,
  duration_seconds   int,
  share_code         text unique not null default substr(md5(random()::text), 1, 8),
  transcript_status  text not null default 'pending'
                       check (transcript_status in ('pending', 'ready', 'unavailable')),
  transcript_lang    text,
  created_at         timestamptz default now() not null
);
alter table videos enable row level security;
create policy "videos_teacher_all" on videos
  for all using (auth.uid() = teacher_id);
create policy "videos_public_read" on videos
  for select using (true);


-- ── Transcript cache (shared across teachers) ─────────────────
create table youtube_transcripts (
  youtube_video_id  text not null,
  language          text not null,
  segments          jsonb not null,
  source            text,   -- 'native_iw' | 'translated_en_he' | 'english' | 'default'
  fetched_at        timestamptz default now() not null,
  primary key (youtube_video_id, language)
);
alter table youtube_transcripts enable row level security;
create policy "transcripts_teacher_read" on youtube_transcripts
  for select using (
    exists (select 1 from teachers where teachers.id = auth.uid())
  );
create policy "transcripts_teacher_insert" on youtube_transcripts
  for insert with check (
    exists (select 1 from teachers where teachers.id = auth.uid())
  );
create policy "transcripts_teacher_update" on youtube_transcripts
  for update using (
    exists (select 1 from teachers where teachers.id = auth.uid())
  );


-- ── Quiz checkpoints ─────────────────────────────────────────
create table quiz_checkpoints (
  id               uuid primary key default gen_random_uuid(),
  video_id         uuid not null references videos(id) on delete cascade,
  position_seconds int not null,
  label            text,
  order_index      int not null default 0
);
alter table quiz_checkpoints enable row level security;
create policy "checkpoints_teacher_all" on quiz_checkpoints
  for all using (
    exists (select 1 from videos where videos.id = video_id and videos.teacher_id = auth.uid())
  );
create policy "checkpoints_public_read" on quiz_checkpoints
  for select using (true);


-- ── Quiz questions ───────────────────────────────────────────
create table quiz_questions (
  id             uuid primary key default gen_random_uuid(),
  checkpoint_id  uuid not null references quiz_checkpoints(id) on delete cascade,
  question       text not null,
  options        jsonb not null,   -- string[4]
  correct_index  int not null check (correct_index between 0 and 3),
  explanation    text,
  ai_generated   boolean default true,
  order_index    int not null default 0
);
alter table quiz_questions enable row level security;
create policy "questions_teacher_all" on quiz_questions
  for all using (
    exists (
      select 1 from quiz_checkpoints
      join videos on videos.id = quiz_checkpoints.video_id
      where quiz_checkpoints.id = checkpoint_id
        and videos.teacher_id = auth.uid()
    )
  );
create policy "questions_public_read" on quiz_questions
  for select using (true);


-- ── Student sessions ─────────────────────────────────────────
create table student_sessions (
  id               uuid primary key default gen_random_uuid(),
  video_id         uuid not null references videos(id) on delete cascade,
  supabase_user_id uuid references auth.users(id),
  student_name     text,
  started_at       timestamptz default now() not null,
  completed_at     timestamptz,
  final_score      int,
  total_questions  int
);
alter table student_sessions enable row level security;
create policy "sessions_student_all" on student_sessions
  for all using (auth.uid() = supabase_user_id);
create policy "sessions_teacher_read" on student_sessions
  for select using (
    exists (select 1 from videos where videos.id = video_id and videos.teacher_id = auth.uid())
  );


-- ── Student answers ──────────────────────────────────────────
create table student_answers (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references student_sessions(id) on delete cascade,
  question_id     uuid not null references quiz_questions(id),
  selected_index  int not null,
  is_correct      boolean not null,
  answered_at     timestamptz default now() not null
);
alter table student_answers enable row level security;
create policy "answers_student_all" on student_answers
  for all using (
    exists (
      select 1 from student_sessions
      where student_sessions.id = session_id
        and student_sessions.supabase_user_id = auth.uid()
    )
  );
create policy "answers_teacher_read" on student_answers
  for select using (
    exists (
      select 1 from student_sessions
      join videos on videos.id = student_sessions.video_id
      where student_sessions.id = session_id
        and videos.teacher_id = auth.uid()
    )
  );


-- ── Student events (confusion heatmap + Ask AI log) ──────────
create table student_events (
  id                      uuid primary key default gen_random_uuid(),
  session_id              uuid not null references student_sessions(id) on delete cascade,
  event_type              text not null
                            check (event_type in ('confusion', 'ask_ai', 'quiz_checkpoint')),
  video_timestamp_seconds int,
  query                   text,
  response                text,
  created_at              timestamptz default now() not null
);
alter table student_events enable row level security;
create policy "events_student_insert" on student_events
  for insert with check (
    exists (
      select 1 from student_sessions
      where student_sessions.id = session_id
        and student_sessions.supabase_user_id = auth.uid()
    )
  );
create policy "events_student_read" on student_events
  for select using (
    exists (
      select 1 from student_sessions
      where student_sessions.id = session_id
        and student_sessions.supabase_user_id = auth.uid()
    )
  );
create policy "events_teacher_read" on student_events
  for select using (
    exists (
      select 1 from student_sessions
      join videos on videos.id = student_sessions.video_id
      where student_sessions.id = session_id
        and videos.teacher_id = auth.uid()
    )
  );

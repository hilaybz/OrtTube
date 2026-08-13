-- ============================================================
-- Order questions by VIDEO TIME, not authoring order
--
-- `questions.order_index` is assigned as `max + 1` when a teacher adds a
-- question, so it records WHEN THE QUESTION WAS WRITTEN. Every read sorted by it
-- first and treated `position_seconds` as a tiebreak, which made authoring order
-- outrank the video timeline.
--
-- For a teacher that showed up as an unsorted list. For a student it was worse:
-- the player takes the next checkpoint to be the first unanswered question in
-- this order and gates the video at its timestamp, so a question authored late
-- but positioned early arrived AFTER a later one — with its gate behind the
-- playhead, which snaps the video backwards. Adding a question at 0:30 to a quiz
-- that already had one at 1:30 was enough to trigger it.
--
-- Time now leads and `order_index` becomes the tiebreak, which is the job it can
-- actually do well: deciding which of two questions at the SAME timestamp comes
-- first, where "whichever was authored first" is the right answer. No column
-- changes and no data rewrite — only the order these three functions read in.
--
-- `start_or_resume_attempt` is the exception worth reading twice. It snapshots
-- into `attempt_questions.order_index`, and that column means "the order for THIS
-- attempt" — so it now stores a time-derived rank rather than a copy of the
-- question's authoring index. That keeps the snapshot's whole purpose intact: an
-- attempt's sequence is frozen at start, and a teacher retiming a question
-- mid-attempt cannot reshuffle a student's remaining questions. It also leaves
-- get_attempt_review correct with no change, since sorting by that column was
-- already the right thing to do.
--
-- Existing rows are deliberately NOT backfilled: no attempt predating this
-- migration is still in flight.
-- ============================================================

create or replace function public.get_quiz_for_student(
  p_class_id uuid,
  p_quiz_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student    uuid := auth.uid();
  v_quiz       public.quizzes;
  v_pref       text;
  v_class_lang text;
  v_resolved   text;
  v_questions  jsonb;
  v_complete   boolean;
  v_attempt_id uuid;
begin
  if v_student is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  -- Membership: the caller must be enrolled in the class.
  if not exists (
    select 1 from public.class_members m
    where m.class_id = p_class_id and m.student_id = v_student
  ) then
    raise exception 'not_member' using errcode = 'P0001';
  end if;

  -- Assignment + quiz existence/non-deleted. A soft-deleted quiz must stop
  -- appearing even though its class_quizzes row still exists (spec §3.4).
  select q.* into v_quiz
  from public.quizzes q
  join public.class_quizzes cq on cq.quiz_id = q.id and cq.class_id = p_class_id
  where q.id = p_quiz_id and q.deleted_at is null;
  if not found then
    raise exception 'not_assigned' using errcode = 'P0002';
  end if;

  -- Resolve the read language by precedence (spec §3.4). base_language is the
  -- guaranteed fallback (NOT NULL column).
  select preferred_language into v_pref from public.profiles where id = v_student;
  select language into v_class_lang from public.classes where id = p_class_id;
  v_resolved := coalesce(
    case when v_pref       in ('he','ar','en') then v_pref       end,
    case when v_class_lang in ('he','ar','en') then v_class_lang end,
    v_quiz.base_language
  );

  -- Serve the FROZEN snapshot for an in-progress attempt (spec §3.5). If the
  -- student has an incomplete attempt on this (class, quiz), we serve exactly the
  -- questions captured in attempt_questions at start — INCLUDING any question
  -- soft-deleted mid-attempt — so the student can answer precisely what they will
  -- be scored on (a since-deleted snapshot question would otherwise be unanswerable
  -- and cap the score below 100%). With no active attempt (preview / not yet
  -- started) we serve the live, non-deleted set.
  select a.id into v_attempt_id
  from public.attempts a
  where a.student_id = v_student
    and a.class_id   = p_class_id
    and a.quiz_id    = p_quiz_id
    and a.completed_at is null
  order by a.attempt_no desc
  limit 1;

  -- Build the question list. Per row we prefer the resolved-language translation
  -- and fall back to the base-language row when it is missing. `row_complete`
  -- flags whether the resolved language was fully available (question prompt +
  -- every live option) so the caller can decide whether to enqueue a translation.
  select
    coalesce(jsonb_agg(sub.qj order by sub.q_pos, sub.q_order, sub.q_id), '[]'::jsonb),
    bool_and(sub.row_complete)
  into v_questions, v_complete
  from (
    select
      q.id                 as q_id,
      q.order_index        as q_order,
      q.position_seconds   as q_pos,
      (
        qt_r.question_id is not null
        and not exists (
          select 1
          from public.question_options o
          left join public.option_translations otr
            on otr.option_id = o.id and otr.language = v_resolved
          where o.question_id = q.id
            and o.deleted_at is null
            and otr.option_id is null
        )
      ) as row_complete,
      jsonb_build_object(
        'id',               q.id,
        'kind',             q.kind,
        'position_seconds', q.position_seconds,
        'order_index',      q.order_index,
        'prompt',           coalesce(qt_r.prompt, qt_b.prompt),
        -- NO explanation in the answer-free load payload: an explanation can
        -- reveal the correct answer. Explanations are delivered only via
        -- get_attempt_review, and only once the reveal rule is satisfied.
        'options', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'id',          o.id,
                     'order_index', o.order_index,
                     'text',        coalesce(otr.text, otb.text)
                   ) order by o.order_index, o.id
                 )
          from public.question_options o
          left join public.option_translations otr
            on otr.option_id = o.id and otr.language = v_resolved
          left join public.option_translations otb
            on otb.option_id = o.id and otb.language = v_quiz.base_language
          where o.question_id = q.id and o.deleted_at is null
        ), '[]'::jsonb)
      ) as qj
    from public.questions q
    left join public.question_translations qt_r
      on qt_r.question_id = q.id and qt_r.language = v_resolved
    left join public.question_translations qt_b
      on qt_b.question_id = q.id and qt_b.language = v_quiz.base_language
    where q.quiz_id = p_quiz_id
      and (
        -- in-progress attempt → the frozen snapshot (incl. since-soft-deleted)
        (v_attempt_id is not null and exists (
           select 1 from public.attempt_questions aq
           where aq.attempt_id = v_attempt_id and aq.question_id = q.id
         ))
        -- no active attempt → the live, non-deleted set
        or (v_attempt_id is null and q.deleted_at is null)
      )
  ) sub;

  return jsonb_build_object(
    'quiz_id',           v_quiz.id,
    'class_id',          p_class_id,
    'title',             v_quiz.title,
    'base_language',     v_quiz.base_language,
    'resolved_language', v_resolved,
    -- true when there were no questions, or every resolved-language row was present.
    'served_complete',   coalesce(v_complete, true),
    'questions',         v_questions
  );
end;
$$;

revoke all on function public.get_quiz_for_student(uuid, uuid) from public;
grant execute on function public.get_quiz_for_student(uuid, uuid) to authenticated, service_role;

create or replace function public.start_or_resume_attempt(
  p_class_id uuid,
  p_quiz_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student   uuid := auth.uid();
  v_cq        public.class_quizzes;
  v_existing  public.attempts;
  v_completed int;
  v_next_no   int;
  v_attempt   public.attempts;
  v_answered  jsonb;
begin
  if v_student is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.class_members m
    where m.class_id = p_class_id and m.student_id = v_student
  ) then
    raise exception 'not_member' using errcode = 'P0001';
  end if;

  select cq.* into v_cq
  from public.class_quizzes cq
  join public.quizzes q on q.id = cq.quiz_id
  where cq.class_id = p_class_id and cq.quiz_id = p_quiz_id and q.deleted_at is null;
  if not found then
    raise exception 'not_assigned' using errcode = 'P0002';
  end if;

  -- Serialize the whole allocation for this (student, class, quiz). The lock is
  -- transaction-scoped, so it is held only for this quick txn — safe under the
  -- transaction-mode pooler (plan §0). Taken before the resume/max checks so two
  -- concurrent starts cannot both pass max_attempts or both allocate the same no.
  perform pg_advisory_xact_lock(
    hashtextextended(v_student::text || '|' || p_class_id::text || '|' || p_quiz_id::text, 0)
  );

  -- Resume the newest incomplete attempt, if any.
  select * into v_existing
  from public.attempts
  where student_id = v_student and class_id = p_class_id and quiz_id = p_quiz_id
    and completed_at is null
  order by attempt_no desc
  limit 1;

  if found then
    select coalesce(jsonb_agg(question_id), '[]'::jsonb) into v_answered
    from public.answers where attempt_id = v_existing.id;
    return jsonb_build_object(
      'attempt_id',            v_existing.id,
      'attempt_no',            v_existing.attempt_no,
      'resumed',               true,
      'started_at',            v_existing.started_at,
      'answered_question_ids', v_answered
    );
  end if;

  -- Enforce max_attempts — completed attempts only.
  select count(*) into v_completed
  from public.attempts
  where student_id = v_student and class_id = p_class_id and quiz_id = p_quiz_id
    and completed_at is not null;

  if v_cq.max_attempts is not null and v_completed >= v_cq.max_attempts then
    raise exception 'no_attempts_left' using errcode = 'P0001';
  end if;

  select coalesce(max(attempt_no), 0) + 1 into v_next_no
  from public.attempts
  where student_id = v_student and class_id = p_class_id and quiz_id = p_quiz_id;

  insert into public.attempts (student_id, class_id, quiz_id, attempt_no)
  values (v_student, p_class_id, p_quiz_id, v_next_no)
  returning * into v_attempt;

  -- Materialize the start-time question snapshot.
  insert into public.attempt_questions (attempt_id, question_id, order_index)
  select v_attempt.id, q.id,
         row_number() over (order by q.position_seconds, q.order_index, q.id)
  from public.questions q
  where q.quiz_id = p_quiz_id and q.deleted_at is null;

  return jsonb_build_object(
    'attempt_id',            v_attempt.id,
    'attempt_no',            v_attempt.attempt_no,
    'resumed',               false,
    'started_at',            v_attempt.started_at,
    'answered_question_ids', '[]'::jsonb
  );
end;
$$;

revoke all on function public.start_or_resume_attempt(uuid, uuid) from public;
grant execute on function public.start_or_resume_attempt(uuid, uuid) to authenticated, service_role;

create or replace function public.get_quiz_for_author(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_lang text;
  v_quiz      jsonb;
  v_video     jsonb;
  v_questions jsonb;
  v_languages jsonb;
begin
  -- Owner check (author of the quiz, non-deactivated), matching analytics.
  if not exists (
    select 1
    from public.quizzes q
    join public.profiles p on p.id = q.author_id
    where q.id = p_quiz_id
      and q.author_id = auth.uid()
      and p.deactivated_at is null
  ) then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  select base_language into v_base_lang from public.quizzes where id = p_quiz_id;

  -- Quiz meta + canonical video.
  select
    jsonb_build_object(
      'quiz_id',       q.id,
      'title',         q.title,
      'base_language', q.base_language,
      'visibility',    q.visibility
    ),
    jsonb_build_object(
      'id',               v.id,
      'youtube_video_id', v.youtube_video_id,
      'title',            v.title,
      'duration_seconds', v.duration_seconds,
      'transcript_status', v.transcript_status
    )
  into v_quiz, v_video
  from public.quizzes q
  join public.videos v on v.id = q.video_id
  where q.id = p_quiz_id;

  -- Non-deleted questions with base-language text and their non-deleted options.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',               q.id,
        'kind',             q.kind,
        'position_seconds', q.position_seconds,
        'order_index',      q.order_index,
        'prompt',           qt.prompt,
        'explanation',      qt.explanation,
        'options', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id',          o.id,
                'is_correct',  o.is_correct,
                'order_index', o.order_index,
                'text',        ot.text
              )
              order by o.order_index, o.id
            ),
            '[]'::jsonb
          )
          from public.question_options o
          left join public.option_translations ot
            on ot.option_id = o.id and ot.language = v_base_lang
          where o.question_id = q.id
            and o.deleted_at is null
        )
      )
      order by q.position_seconds, q.order_index, q.id
    ),
    '[]'::jsonb
  )
  into v_questions
  from public.questions q
  left join public.question_translations qt
    on qt.question_id = q.id and qt.language = v_base_lang
  where q.quiz_id = p_quiz_id
    and q.deleted_at is null;

  -- Non-base languages that already have any translation row (question or option).
  select coalesce(jsonb_agg(distinct lang), '[]'::jsonb)
  into v_languages
  from (
    select qt.language as lang
    from public.question_translations qt
    join public.questions q on q.id = qt.question_id
    where q.quiz_id = p_quiz_id
      and qt.language <> v_base_lang
    union
    select ot.language as lang
    from public.option_translations ot
    join public.question_options o on o.id = ot.option_id
    join public.questions q on q.id = o.question_id
    where q.quiz_id = p_quiz_id
      and ot.language <> v_base_lang
  ) langs;

  return v_quiz
    || jsonb_build_object(
         'video',                v_video,
         'transcript_status',    v_video->'transcript_status',
         'questions',            v_questions,
         'translated_languages', v_languages
       );
end;
$$;

revoke all on function public.get_quiz_for_author(uuid) from public;
grant execute on function public.get_quiz_for_author(uuid) to authenticated, service_role;

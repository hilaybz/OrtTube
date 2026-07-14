-- ============================================================
-- Answer-free student quiz read (spec §3.4 / §3.5)
--
-- get_quiz_for_student(class_id, quiz_id): the ONLY path by which a student sees
-- a quiz. Students have NO direct SELECT on question_options / *_translations
-- (012_grants + 013_rls), so this SECURITY DEFINER RPC is the trust boundary:
--   • verifies the caller is a member of the class AND the quiz is assigned to it
--     and non-deleted,
--   • returns questions + options with text resolved to the student's language
--     (preferred_language -> classes.language -> quizzes.base_language),
--   • falls back to base_language per-row when the resolved language is missing,
--   • NEVER returns is_correct or any answer-key data.
--
-- Deactivated-teacher content stays visible to enrolled students (plan Appendix
-- C): we gate only on assignment + soft-delete, never on the owner's
-- deactivated_at. Translation fill is a Node concern (ensureTranslation); the
-- RPC exposes `served_complete=false` so the caller (lib/attempts.ts) can enqueue
-- it best-effort. The read itself always succeeds by falling back to base.
--
-- Stable error codes (raised as the exception MESSAGE):
--   unauthorized, not_member, not_assigned.
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
    coalesce(jsonb_agg(sub.qj order by sub.q_order, sub.q_pos, sub.q_id), '[]'::jsonb),
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

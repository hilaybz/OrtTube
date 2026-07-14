-- ============================================================
-- Reveal-gated attempt review (spec §3.5, reveal gate)
--
-- get_attempt_review(attempt_id) — SECURITY DEFINER: the ONLY path by which a
-- student learns per-question correctness / correct options / explanations.
-- Students have NO direct SELECT on answers / answer_selections (012/013), so
-- this RPC is the trust boundary.
--
-- REVEAL GATE (product decision):
--   • not completed              → { revealed:false, completed:false }
--   • completed but attempts remain (max_attempts NULL = unlimited, OR
--     completed_count < max_attempts) → score only:
--       { revealed:false, completed:true, num_correct, num_questions }
--   • completed AND exhausted (max_attempts NOT NULL AND completed_count >=
--     max_attempts) → full per-question review:
--       { revealed:true, completed:true, num_correct, num_questions,
--         questions:[{question_id, was_correct, correct_option_ids[],
--                     explanation, selected_option_ids[]}] }
--
-- The explanation is resolved to the student's language with the same precedence
-- as get_quiz_for_student (preferred → class → quiz base).
--
-- Stable error codes: unauthorized, attempt_not_found, not_your_attempt.
-- ============================================================

create or replace function public.get_attempt_review(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student    uuid := auth.uid();
  v_attempt    public.attempts;
  v_num_questions      int;
  v_num_correct      int;
  v_completed  int;
  v_max        int;
  v_pref       text;
  v_class_lang text;
  v_base       text;
  v_resolved   text;
  v_exhausted  boolean;
  v_questions  jsonb;
begin
  if v_student is null then
    raise exception 'unauthorized' using errcode = 'P0001';
  end if;

  select * into v_attempt from public.attempts where id = p_attempt_id;
  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;
  if v_attempt.student_id is distinct from v_student then
    raise exception 'not_your_attempt' using errcode = 'P0001';
  end if;

  -- Not finished → nothing to reveal, not even a score.
  if v_attempt.completed_at is null then
    return jsonb_build_object('revealed', false, 'completed', false);
  end if;

  -- Aggregate score from the frozen snapshots (mirrors complete_attempt).
  select count(*) into v_num_questions
  from public.attempt_questions where attempt_id = p_attempt_id;
  select count(*) into v_num_correct
  from public.answers where attempt_id = p_attempt_id and was_correct;

  -- Completed attempts for this (student, class, quiz) + the attempt cap.
  select count(*) into v_completed
  from public.attempts
  where student_id = v_student
    and class_id   = v_attempt.class_id
    and quiz_id    = v_attempt.quiz_id
    and completed_at is not null;

  select max_attempts into v_max
  from public.class_quizzes
  where class_id = v_attempt.class_id and quiz_id = v_attempt.quiz_id;

  -- Reveal only when NO attempts remain: cap is finite AND all are used up.
  -- Unlimited (max_attempts NULL) never reveals per-question detail.
  v_exhausted := (v_max is not null and v_completed >= v_max);

  if not v_exhausted then
    return jsonb_build_object(
      'revealed',      false,
      'completed',     true,
      'num_correct',   v_num_correct,
      'num_questions', v_num_questions
    );
  end if;

  -- Resolve the explanation language (same precedence as get_quiz_for_student).
  select preferred_language into v_pref from public.profiles where id = v_student;
  select language into v_class_lang from public.classes where id = v_attempt.class_id;
  select base_language into v_base from public.quizzes where id = v_attempt.quiz_id;
  v_resolved := coalesce(
    case when v_pref       in ('he','ar','en') then v_pref       end,
    case when v_class_lang in ('he','ar','en') then v_class_lang end,
    v_base
  );

  -- Per-question review over the attempt's frozen snapshot.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'question_id',        aq.question_id,
             'was_correct',        ans.was_correct,
             'correct_option_ids', coalesce((
                 select jsonb_agg(o.id order by o.order_index, o.id)
                 from public.question_options o
                 where o.question_id = aq.question_id
                   and o.is_correct
                   and o.deleted_at is null
               ), '[]'::jsonb),
             'explanation',        case when qt_r.question_id is not null
                                        then qt_r.explanation else qt_b.explanation end,
             'selected_option_ids', coalesce((
                 select jsonb_agg(sel.option_id)
                 from public.answer_selections sel
                 where sel.answer_id = ans.id
               ), '[]'::jsonb)
           )
           order by aq.order_index, aq.question_id
         ), '[]'::jsonb)
    into v_questions
  from public.attempt_questions aq
  left join public.answers ans
    on ans.attempt_id = aq.attempt_id and ans.question_id = aq.question_id
  left join public.question_translations qt_r
    on qt_r.question_id = aq.question_id and qt_r.language = v_resolved
  left join public.question_translations qt_b
    on qt_b.question_id = aq.question_id and qt_b.language = v_base
  where aq.attempt_id = p_attempt_id;

  return jsonb_build_object(
    'revealed',      true,
    'completed',     true,
    'num_correct',   v_num_correct,
    'num_questions', v_num_questions,
    'questions',     v_questions
  );
end;
$$;

revoke all on function public.get_attempt_review(uuid) from public;
grant execute on function public.get_attempt_review(uuid) to authenticated, service_role;

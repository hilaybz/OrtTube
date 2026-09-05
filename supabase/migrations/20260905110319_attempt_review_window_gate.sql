-- ============================================================
-- get_attempt_review: restore the window half of the reveal gate
--
-- REPAIR. The immediately preceding migration
-- (20260905094105_attempt_review_question_text) added `prompt` + `options` to
-- this function, but built its body from 064_get_attempt_review — the ORIGINAL
-- definition, not the current one. 129_attempt_window_finalization had since
-- widened the reveal gate to treat a closed scheduling window as "no retake
-- remains". Being the later migration, the rewrite won and silently reverted
-- that, with no error and no failing test in a default `npm test` (the test
-- that covers it, test/attempts/window.int.test.ts, skips without a local
-- stack).
--
-- Symptom: a quiz with a window AND attempts remaining. The student completes
-- an attempt, the window closes, so retaking is impossible — but the cap was
-- never reached, so the gate stayed shut and the student was told their answers
-- would appear "once no attempts remain", permanently.
--
-- This is 129's body with the `prompt`/`options` additions re-applied on top.
--
-- Copying a whole function body forward is how this repo versions RPCs, so the
-- hazard is structural: ALWAYS source the body from the LATEST definition, not
-- the first one. Find it with:
--   grep -l 'function public.<name>' supabase/migrations/ | sort | tail -1
-- ============================================================

create or replace function public.get_attempt_review(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student       uuid := auth.uid();
  v_attempt       public.attempts;
  v_num_questions int;
  v_num_correct   int;
  v_completed     int;
  v_max           int;
  v_until         timestamptz;
  v_pref          text;
  v_class_lang    text;
  v_base          text;
  v_resolved      text;
  v_exhausted     boolean;
  v_questions     jsonb;
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

  -- Completed attempts for this (student, class, quiz) + the attempt cap + window.
  select count(*) into v_completed
  from public.attempts
  where student_id = v_student
    and class_id   = v_attempt.class_id
    and quiz_id    = v_attempt.quiz_id
    and completed_at is not null;

  select max_attempts, available_until into v_max, v_until
  from public.class_quizzes
  where class_id = v_attempt.class_id and quiz_id = v_attempt.quiz_id;

  -- Reveal when no retake remains: the cap is finite and used up, OR the
  -- window that gated retaking has closed. Unlimited attempts with no window
  -- never reveal per-question detail.
  v_exhausted := (v_max is not null and v_completed >= v_max)
              or (v_until is not null and v_until <= now());

  if not v_exhausted then
    return jsonb_build_object(
      'revealed',      false,
      'completed',     true,
      'num_correct',   v_num_correct,
      'num_questions', v_num_questions
    );
  end if;

  -- Resolve the text language (same precedence as get_quiz_for_student).
  select preferred_language into v_pref from public.profiles where id = v_student;
  select language into v_class_lang from public.classes where id = v_attempt.class_id;
  select base_language into v_base from public.quizzes where id = v_attempt.quiz_id;
  v_resolved := coalesce(
    case when v_pref       in ('he','ar','en') then v_pref       end,
    case when v_class_lang in ('he','ar','en') then v_class_lang end,
    v_base
  );

  -- Per-question review over the attempt's frozen snapshot. Deliberately keyed
  -- only on attempt_questions/attempts — never on class_quizzes liveness, so a
  -- closed window or later unassignment can't blank out a finished review.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'question_id',        aq.question_id,
             'was_correct',        ans.was_correct,
             'prompt',             coalesce(qt_r.prompt, qt_b.prompt),
             'correct_option_ids', coalesce((
                 select jsonb_agg(o.id order by o.order_index, o.id)
                 from public.question_options o
                 where o.question_id = aq.question_id
                   and o.is_correct
                   and o.deleted_at is null
               ), '[]'::jsonb),
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
                   on otb.option_id = o.id and otb.language = v_base
                 where o.question_id = aq.question_id and o.deleted_at is null
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

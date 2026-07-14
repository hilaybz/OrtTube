-- ============================================================
-- Analytics: question_stats(quiz_id)
-- Per-question correct% (from `answers.was_correct`) plus the distractor
-- distribution (from `answer_selections` grouped by option).
--
-- The distractor distribution INCLUDES soft-deleted options (no `deleted_at`
-- filter on `question_options`) so historical selections still read — spec §3.4
-- and analytics acceptance. Soft-deleted questions are likewise included and flagged,
-- so nothing disappears from the owner's audit view.
--
-- This is owner-facing analytics, so it deliberately DOES surface `is_correct`
-- and the base-language text. It never reaches a student because non-owners are
-- rejected (`not_owner`); the "never leak is_correct" rule is about student read
-- paths, not the owner's own analytics.
-- ============================================================

create or replace function public.question_stats(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_lang text;
  v_questions jsonb;
begin
  -- Owner check.
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'question_id', q.id,
        'kind', q.kind,
        'order_index', q.order_index,
        'deleted', (q.deleted_at is not null),
        'position_seconds', q.position_seconds,
        'prompt', qt.prompt,
        'total_answers', (
          select count(*) from public.answers a where a.question_id = q.id
        ),
        'correct_count', (
          select count(*) from public.answers a
          where a.question_id = q.id and a.was_correct
        ),
        'correct_pct', (
          select case
                   when count(*) = 0 then null
                   else count(*) filter (where a.was_correct)::numeric / count(*)
                 end
          from public.answers a
          where a.question_id = q.id
        ),
        'options', (
          -- All options, including soft-deleted, for full distractor history.
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'option_id', o.id,
                'is_correct', o.is_correct,
                'deleted', (o.deleted_at is not null),
                'order_index', o.order_index,
                'text', ot.text,
                'selection_count', (
                  select count(*)
                  from public.answer_selections sel
                  join public.answers a2 on a2.id = sel.answer_id
                  where sel.option_id = o.id
                    and a2.question_id = q.id
                )
              )
              order by o.order_index, o.id
            ),
            '[]'::jsonb
          )
          from public.question_options o
          left join public.option_translations ot
            on ot.option_id = o.id and ot.language = v_base_lang
          where o.question_id = q.id
        )
      )
      order by q.order_index, q.id
    ),
    '[]'::jsonb
  )
  into v_questions
  from public.questions q
  left join public.question_translations qt
    on qt.question_id = q.id and qt.language = v_base_lang
  where q.quiz_id = p_quiz_id;

  return jsonb_build_object(
    'quiz_id', p_quiz_id,
    'base_language', v_base_lang,
    'questions', v_questions
  );
end;
$$;

revoke execute on function public.question_stats(uuid) from public;
grant execute on function public.question_stats(uuid) to authenticated, service_role;

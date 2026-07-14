-- ============================================================
-- Analytics: tutor_prompts_in_scope(quiz_id | class_id)
-- The raw tutor prompts a teacher's students asked, for ONE scope (a quiz OR a
-- class), most recent first and capped to a bounded payload.
--
-- This is distinct from `tutor_stats` (093): that function returns only the
-- FLAGGED subset (`question_id IS NOT NULL` — likely answer-extraction attempts)
-- for audit. The "most-asked-questions → topic clusters" analytic needs the FULL
-- set of prompts in scope to feed an LLM clusterer, which the flagged list can't
-- provide. Hence a separate owner-checked reader.
--
-- Exactly ONE of `p_quiz_id` / `p_class_id` must be supplied; passing both or
-- neither raises `invalid_args` (mirrors `tutor_stats`).
--
-- Owner-checked for the given scope (quiz author / class teacher, not
-- deactivated) against `auth.uid()`. Students have no execute grant.
--
-- Returns a JSON array of `{ prompt, question_id, created_at }`, ordered most
-- recent first and capped at 500 rows. Anonymized rows (`student_id IS NULL`)
-- are included — the clusterer never sees per-student attribution, only prompt
-- text, so anonymity is preserved.
-- ============================================================

create or replace function public.tutor_prompts_in_scope(
  p_quiz_id uuid default null,
  p_class_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prompts jsonb;
begin
  -- Exactly one scope required (XOR) — same rule as tutor_stats.
  if (p_quiz_id is null) = (p_class_id is null) then
    raise exception 'invalid_args: exactly one of quiz_id/class_id required'
      using errcode = '22023';
  end if;

  if p_quiz_id is not null then
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
  else
    if not public.is_teacher_of_class(p_class_id) then
      raise exception 'not_owner' using errcode = '42501';
    end if;
  end if;

  -- Recent prompts in scope (most recent first, capped for a bounded payload).
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'prompt', f.prompt,
        'question_id', f.question_id,
        'created_at', f.created_at
      )
      order by f.created_at desc
    ),
    '[]'::jsonb
  )
  into v_prompts
  from (
    select tq.prompt, tq.question_id, tq.created_at
    from public.tutor_questions tq
    where tq.prompt is not null
      and length(btrim(tq.prompt)) > 0
      and (
        (p_quiz_id is not null and tq.quiz_id = p_quiz_id)
        or (p_class_id is not null and tq.class_id = p_class_id)
      )
    order by tq.created_at desc
    limit 500
  ) f;

  return jsonb_build_object(
    'scope', case when p_quiz_id is not null then 'quiz' else 'class' end,
    'prompts', v_prompts
  );
end;
$$;

revoke execute on function public.tutor_prompts_in_scope(uuid, uuid) from public;
grant execute on function public.tutor_prompts_in_scope(uuid, uuid) to authenticated, service_role;

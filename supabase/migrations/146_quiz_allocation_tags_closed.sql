-- ============================================================
-- list_my_quiz_allocation_tags: a third bucket for closed windows
--
-- The card tags read (130_quiz_allocation_reads.sql) reported only `live` and
-- `scheduled`, so "the window already closed" and "there was never an
-- allocation" arrived at the client as the same thing: two empty arrays. That
-- cost the library card an honest status line ("הסתיים" vs "טיוטה") and left
-- the quiz library unable to offer the status axis the teacher home's KPI
-- tiles link into ("חידונים פעילים" / "חידונים שהסתיימו").
--
-- `closed` mirrors `allocationState`'s `done` exactly (lib/allocationState.ts,
-- itself pinned to `_allocation_is_live` from 128): published, the end bound
-- has passed, and — the part a naive `available_until <= now()` would get
-- wrong — the start bound has NOT still to come. An allocation whose window
-- is inverted (until before from) is `scheduled` in the TypeScript
-- derivation, which checks the start bound first; without the guard below it
-- would appear in `scheduled` and `closed` at once and be counted as both
-- active and finished.
--
-- Buckets stay class-owner-scoped and the quiz-level scope is untouched: a
-- quiz with no allocation on any class THIS teacher owns is still absent
-- entirely, and a draft-only quiz still appears with every bucket empty.
-- ============================================================

create or replace function public.list_my_quiz_allocation_tags()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'quiz_id', q.id,
               'live', coalesce((
                 select jsonb_agg(
                          jsonb_build_object('class_id', c.id, 'class_name', c.name)
                          order by c.name
                        )
                 from public.class_quizzes cq
                 join public.classes c on c.id = cq.class_id
                 where cq.quiz_id = q.id
                   and c.teacher_id = auth.uid()
                   and public._allocation_is_live(cq)
               ), '[]'::jsonb),
               'scheduled', coalesce((
                 select jsonb_agg(
                          jsonb_build_object('class_id', c.id, 'class_name', c.name)
                          order by c.name
                        )
                 from public.class_quizzes cq
                 join public.classes c on c.id = cq.class_id
                 where cq.quiz_id = q.id
                   and c.teacher_id = auth.uid()
                   and cq.published
                   and cq.available_from is not null
                   and cq.available_from > now()
               ), '[]'::jsonb),
               'closed', coalesce((
                 select jsonb_agg(
                          jsonb_build_object('class_id', c.id, 'class_name', c.name)
                          order by c.name
                        )
                 from public.class_quizzes cq
                 join public.classes c on c.id = cq.class_id
                 where cq.quiz_id = q.id
                   and c.teacher_id = auth.uid()
                   and cq.published
                   and cq.available_until is not null
                   and cq.available_until <= now()
                   -- The `scheduled` guard: a start bound still in the future
                   -- wins, exactly as in `allocationState`.
                   and (cq.available_from is null or cq.available_from <= now())
               ), '[]'::jsonb)
             )
           )
    from public.quizzes q
    where q.author_id = auth.uid()
      and q.deleted_at is null
      and exists (
        select 1 from public.class_quizzes cq
        join public.classes c on c.id = cq.class_id
        where cq.quiz_id = q.id and c.teacher_id = auth.uid()
      )
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_my_quiz_allocation_tags() from public;
grant execute on function public.list_my_quiz_allocation_tags() to authenticated, service_role;

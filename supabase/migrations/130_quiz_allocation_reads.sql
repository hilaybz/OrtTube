-- ============================================================
-- Quiz-side allocation reads (Epic 2A.3 / 2A.4 / 1.5)
--
-- Two new owner-scoped reads, keyed by quiz rather than by class (the mirror
-- direction of list_class_quizzes):
--
--   • list_quiz_allocations   — full detail, every state, for the editor's
--     allocation-management section. The owner must see drafts/scheduled/
--     closed allocations, so this is never filtered by _allocation_is_live.
--   • list_my_quiz_allocation_tags — a compact read for card chips (library +
--     dashboard landing page): per quiz, the classes currently LIVE and the
--     classes SCHEDULED for the future, as two small arrays. A quiz whose only
--     allocations are drafts or closed windows still appears, with both
--     arrays empty — that's what renders a plain "טיוטה" badge instead of
--     silently disappearing from the list. A quiz with no allocations at all
--     is absent (this is not the library's "all my quizzes" read).
-- ============================================================

-- ── list_quiz_allocations ─────────────────────────────────────────────────────
-- Owner-checked the same way get_quiz_for_author is (author + not deactivated).
create or replace function public.list_quiz_allocations(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
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

  -- A `shared` quiz can be assigned by ANY same-school teacher
  -- (assign_quiz_to_class permits it), not only its author — so without the
  -- class-ownership filter below, this quiz's author would see every other
  -- teacher's class name/settings for their own allocations of it, with
  -- "עריכה"/"ביטול הקצאה" buttons that would then fail not_owner. Scope to
  -- classes THIS caller owns, same tenant boundary as list_class_quizzes.
  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'class_id',        c.id,
               'class_name',      c.name,
               'class_language',  c.language,
               'tutor_mode',      cq.tutor_mode,
               'max_attempts',    cq.max_attempts,
               'published',       cq.published,
               'available_from',  cq.available_from,
               'available_until', cq.available_until,
               'assigned_at',     cq.assigned_at
             ) order by cq.assigned_at desc
           )
    from public.class_quizzes cq
    join public.classes c on c.id = cq.class_id
    where cq.quiz_id = p_quiz_id
      and c.teacher_id = auth.uid()
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_quiz_allocations(uuid) from public;
grant execute on function public.list_quiz_allocations(uuid) to authenticated, service_role;

-- ── list_my_quiz_allocation_tags ──────────────────────────────────────────────
-- Caller's own non-deleted quizzes that have at least one allocation of ANY
-- state, split into the two buckets the card UI shows. A closed-window or
-- unpublished allocation lands in neither array by construction (see the
-- deferred "quiz finished" issue for surfacing those explicitly).
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
               ), '[]'::jsonb)
             )
           )
    from public.quizzes q
    where q.author_id = auth.uid()
      and q.deleted_at is null
      -- Same class-ownership scope as the buckets above — a quiz whose only
      -- allocations are on another teacher's classes must not appear at all
      -- (an empty-bucket "טיוטה" card would misreport it as never allocated
      -- by anyone, when really it's just not allocated by classes THIS
      -- teacher owns).
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

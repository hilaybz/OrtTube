-- ============================================================
-- Analytics: teacher_analytics_search(scope, query, limit, offset)
--
-- The search-driven analytics hub needs one reader that answers "which of MY
-- entities match this text", for exactly one scope at a time — a class, a
-- student, or a quiz. Without it the hub would have to pull every class, every
-- roster and every quiz into the browser and filter there, which is both a
-- privacy-shaped payload and unbounded.
--
-- Scope semantics (each is the teacher's OWN entity set, never a school-wide
-- directory):
--   * class   — classes this teacher owns.
--   * student — CURRENT members of those classes, deduplicated across them, so a
--               student in three of the teacher's classes appears once. This is
--               the only way a teacher reaches a student here: a uuid that is
--               nobody's student in nobody's class simply does not match.
--   * quiz    — quizzes this teacher AUTHORED and that are not soft-deleted.
--
-- Paged (`p_limit`/`p_offset`) with a `total` alongside the page, so the hub's
-- pager is server-driven rather than slicing a full list client-side.
--
-- Owner model: no per-row owner check is needed because every branch's WHERE
-- clause IS the ownership predicate (`teacher_id = auth.uid()` /
-- `author_id = auth.uid()`). The caller must still be a non-deactivated teacher,
-- which `is_active_teacher()` asserts up front — a deactivated teacher retains
-- no owner access anywhere else either (011_helpers.sql).
--
-- `invalid_args` for an unknown scope, mirroring `tutor_stats`.
-- ============================================================

create or replace function public.teacher_analytics_search(
  p_scope  text,
  p_query  text default null,
  p_limit  int  default 10,
  p_offset int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit   int;
  v_offset  int;
  v_query   text;
  v_pattern text;
  v_total   int;
  v_results jsonb;
begin
  if p_scope is null or p_scope not in ('class', 'student', 'quiz') then
    raise exception 'invalid_args: scope must be one of class/student/quiz'
      using errcode = '22023';
  end if;

  if not public.is_active_teacher() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  -- Bounded window: a caller cannot ask for an unbounded page.
  v_limit  := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  -- An empty query lists everything in scope (the hub's initial state).
  -- LIKE metacharacters in user text are escaped so a `%` searches for a
  -- literal `%` instead of matching everything.
  v_query := nullif(btrim(coalesce(p_query, '')), '');
  v_pattern := case
    when v_query is null then null
    else '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  if p_scope = 'class' then
    select count(*) into v_total
    from public.classes c
    where c.teacher_id = auth.uid()
      and (v_pattern is null or c.name ilike v_pattern);

    select coalesce(jsonb_agg(r.obj order by r.name, r.id), '[]'::jsonb)
    into v_results
    from (
      select
        c.id,
        c.name,
        jsonb_build_object(
          'id',             c.id,
          'name',           c.name,
          'language',       c.language,
          'member_count',   (
            select count(*) from public.class_members m where m.class_id = c.id
          ),
          'quiz_count',     (
            select count(*)
            from public.class_quizzes cq
            join public.quizzes z on z.id = cq.quiz_id
            where cq.class_id = c.id and z.deleted_at is null
          )
        ) as obj
      from public.classes c
      where c.teacher_id = auth.uid()
        and (v_pattern is null or c.name ilike v_pattern)
      order by c.name, c.id
      limit v_limit offset v_offset
    ) r;

  elsif p_scope = 'student' then
    select count(*) into v_total
    from public.profiles p
    where exists (
        select 1
        from public.class_members m
        join public.classes c on c.id = m.class_id
        where m.student_id = p.id and c.teacher_id = auth.uid()
      )
      and (
        v_pattern is null
        or p.display_name ilike v_pattern
        or p.email::text ilike v_pattern
      );

    select coalesce(jsonb_agg(r.obj order by r.display_name nulls last, r.email), '[]'::jsonb)
    into v_results
    from (
      select
        p.display_name,
        p.email,
        jsonb_build_object(
          'id',           p.id,
          'name',         p.display_name,
          'email',        p.email,
          'class_count',  (
            select count(*)
            from public.class_members m
            join public.classes c on c.id = m.class_id
            where m.student_id = p.id and c.teacher_id = auth.uid()
          ),
          'class_names',  (
            select string_agg(c.name, ', ' order by c.name)
            from public.class_members m
            join public.classes c on c.id = m.class_id
            where m.student_id = p.id and c.teacher_id = auth.uid()
          )
        ) as obj
      from public.profiles p
      where exists (
          select 1
          from public.class_members m
          join public.classes c on c.id = m.class_id
          where m.student_id = p.id and c.teacher_id = auth.uid()
        )
        and (
          v_pattern is null
          or p.display_name ilike v_pattern
          or p.email::text ilike v_pattern
        )
      order by p.display_name nulls last, p.email
      limit v_limit offset v_offset
    ) r;

  else -- 'quiz'
    select count(*) into v_total
    from public.quizzes q
    join public.videos v on v.id = q.video_id
    where q.author_id = auth.uid()
      and q.deleted_at is null
      and (v_pattern is null or q.title ilike v_pattern or v.title ilike v_pattern);

    select coalesce(jsonb_agg(r.obj order by r.created_at desc, r.id), '[]'::jsonb)
    into v_results
    from (
      select
        q.id,
        q.created_at,
        jsonb_build_object(
          'id',             q.id,
          'name',           q.title,
          'video_title',    v.title,
          'visibility',     q.visibility,
          'base_language',  q.base_language,
          'question_count', (
            select count(*) from public.questions qs
            where qs.quiz_id = q.id and qs.deleted_at is null
          ),
          'class_count',    (
            select count(*) from public.class_quizzes cq where cq.quiz_id = q.id
          )
        ) as obj
      from public.quizzes q
      join public.videos v on v.id = q.video_id
      where q.author_id = auth.uid()
        and q.deleted_at is null
        and (v_pattern is null or q.title ilike v_pattern or v.title ilike v_pattern)
      order by q.created_at desc, q.id
      limit v_limit offset v_offset
    ) r;
  end if;

  return jsonb_build_object(
    'scope',   p_scope,
    'query',   coalesce(v_query, ''),
    'limit',   v_limit,
    'offset',  v_offset,
    'total',   v_total,
    'results', v_results
  );
end;
$$;

revoke all on function public.teacher_analytics_search(text, text, int, int) from public;
grant execute on function public.teacher_analytics_search(text, text, int, int)
  to authenticated, service_role;

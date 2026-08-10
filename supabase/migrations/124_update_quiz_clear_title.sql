-- ============================================================
-- update_quiz: let a teacher CLEAR the quiz title
--
-- `update_quiz` is a partial patch: a NULL argument means "field not provided,
-- leave it alone". That is right for the other columns, but it made the title
-- impossible to unset — `coalesce(p_title, title)` silently kept the existing
-- title when a teacher emptied the box and saved. The save appeared to succeed
-- and nothing changed, with no way back to the default heading.
--
-- A quiz title is genuinely optional: with none, the UI falls back to the
-- video's title, which is often what a teacher wants. So "no title" has to be
-- expressible. An EMPTY or whitespace-only string is how a teacher says that,
-- and it is not a legitimate title in its own right, so it carries no other
-- meaning and is free to use as the signal:
--
--   p_title IS NULL              → not provided        → unchanged
--   p_title is '' or whitespace  → explicitly cleared  → NULL (default heading)
--   p_title otherwise            → set (trimmed)
--
-- `visibility` and `base_language` keep NULL-means-unchanged unaltered: both are
-- NOT NULL columns with no "absent" state to return to.
-- ============================================================

create or replace function public.update_quiz(
  p_quiz_id       uuid,
  p_title         text default null,
  p_visibility    text default null,
  p_base_language text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert_quiz_owner(p_quiz_id);

  if p_visibility is not null and p_visibility not in ('private','shared') then
    raise exception 'invalid_visibility' using errcode = 'P0001';
  end if;
  if p_base_language is not null and p_base_language not in ('he','ar','en') then
    raise exception 'invalid_base_language' using errcode = 'P0001';
  end if;

  update public.quizzes
    set title         = case
                          when p_title is null       then title
                          when btrim(p_title) = ''   then null
                          else btrim(p_title)
                        end,
        visibility    = coalesce(p_visibility, visibility),
        base_language = coalesce(p_base_language, base_language)
    where id = p_quiz_id;
end;
$$;

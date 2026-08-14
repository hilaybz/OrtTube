-- ============================================================
-- list_shared_quizzes gains channel_name — backlog 1.4's catalog search
-- needs to match on the video's uploading channel, the same way `list_my_quizzes`
-- already lets "My quizzes" search do (migration 132). The column has existed
-- on `videos` since 132; this RPC just never selected it.
--
-- `create or replace` cannot change a RETURNS TABLE(...) shape in place
-- (Postgres error 42P13) — must drop first, same pattern as list_my_quizzes'
-- own fix (132, and the follow-up in this branch's predecessor PR #73).
-- ============================================================

drop function if exists public.list_shared_quizzes();

create or replace function public.list_shared_quizzes()
returns table (
  quiz_id           uuid,
  title             text,
  base_language     text,
  visibility        text,
  video_id          uuid,
  youtube_video_id  text,
  video_title       text,
  channel_name      text,
  transcript_status text,
  question_count    bigint,
  author_id         uuid,
  author_name       text,
  is_own            boolean,
  created_at        timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    q.id,
    q.title,
    q.base_language,
    q.visibility,
    v.id,
    v.youtube_video_id,
    v.title,
    v.channel_name,
    v.transcript_status,
    (select count(*) from public.questions qs
      where qs.quiz_id = q.id and qs.deleted_at is null),
    q.author_id,
    p.display_name,
    (q.author_id = auth.uid()),
    q.created_at
  from public.quizzes q
  join public.videos   v on v.id = q.video_id
  left join public.profiles p on p.id = q.author_id
  where q.visibility = 'shared'
    and q.deleted_at is null
    and q.school_id = public.current_school_id()
    and public.is_active_teacher()
  order by q.created_at desc;
$$;

revoke all on function public.list_shared_quizzes() from public;
grant execute on function public.list_shared_quizzes() to authenticated, service_role;

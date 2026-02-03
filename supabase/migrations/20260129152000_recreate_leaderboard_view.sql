begin;

create or replace view public.leaderboard as
select
  p.id as user_id,
  p.nickname,
  usp.season,
  coalesce(usp.total_points, 0)::numeric as total_points
from public.profiles p
left join public.user_season_points usp
  on usp.user_id = p.id
where usp.season is not null
order by coalesce(usp.total_points, 0) desc, p.nickname nulls last, p.id;

grant select on public.leaderboard to anon, authenticated;

commit;

-- Recreate leaderboard to include all team owners (even with 0 points)

create or replace view public.leaderboard as
with owners as (
  select distinct user_id
  from public.fantasy_teams
  where user_id is not null
)
select
  o.user_id,
  p.nickname,
  '2025-26'::text as season,
  coalesce(usp.total_points, 0)::numeric as total_points
from owners o
left join public.profiles p on p.id = o.user_id
left join public.user_season_points usp
  on usp.user_id = o.user_id
 and usp.season = '2025-26'
order by coalesce(usp.total_points, 0) desc, p.nickname nulls last, o.user_id;

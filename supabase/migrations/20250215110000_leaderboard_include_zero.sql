-- Recreate leaderboard to include users with zero points for season 2025-26

create or replace view public.leaderboard as
select
  p.id as user_id,
  p.nickname,
  '2025-26'::text as season,
  coalesce(usp.total_points, 0)::numeric as total_points
from public.profiles p
left join public.user_season_points usp
  on usp.user_id = p.id
 and usp.season = '2025-26'
order by coalesce(usp.total_points, 0) desc, p.nickname nulls last, p.id;

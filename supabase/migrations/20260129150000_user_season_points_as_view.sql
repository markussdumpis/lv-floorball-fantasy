begin;

-- Replace table with view that aggregates current season totals per user
drop table if exists public.user_season_points cascade;

create or replace view public.user_season_points as
select
  ft.user_id,
  '2025-26'::text as season,
  sum(coalesce(utpv.total_points, 0))::numeric as total_points
from public.user_team_points_view utpv
join public.fantasy_teams ft on ft.id = utpv.fantasy_team_id
group by ft.user_id;

grant select on public.user_season_points to anon, authenticated;

commit;

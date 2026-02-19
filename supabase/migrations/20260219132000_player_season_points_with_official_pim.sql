begin;

create or replace view public.player_season_points_view_display as
select
  v.player_id,
  v.season,
  v.goals,
  v.assists,
  coalesce(
    nullif(to_jsonb(s)->>'penalty_min', '')::int,
    nullif(to_jsonb(s)->>'pen_min', '')::int,
    v.pen_min
  )::int as pen_min,
  v.saves,
  v.goals_against,
  v.fantasy_points_base,
  v.fantasy_points_bonus,
  v.fantasy_points
from public.player_season_points_view v
join public.players p on p.id = v.player_id
left join public.players_stats_staging s
  on s.name = p.name;

grant select on public.player_season_points_view_display to anon, authenticated;

commit;

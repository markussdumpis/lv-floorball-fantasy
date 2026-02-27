begin;

create or replace view public.public_players as
with teams_unique as (
  select distinct on (name)
    name,
    id
  from public.teams
  order by name, id::text
),
latest_finished_season as (
  select season
  from public.matches
  where status = 'finished'
    and season is not null
  order by date desc
  limit 1
),
agg as (
  select
    pmp.player_id,
    count(distinct pmp.match_id) as games,
    sum(coalesce(pmp.fantasy_points, 0) + coalesce(pmp.fantasy_points_bonus, 0)) as total_points
  from public.player_match_points pmp
  join public.matches m on m.id = pmp.match_id
  where m.status = 'finished'
    and m.season = (select season from latest_finished_season)
  group by pmp.player_id
)
select
  p.id,
  p.name,
  p.position,
  p.team,
  p.price::numeric as price,
  p.price::numeric as price_final,
  coalesce(agg.total_points, 0) as fantasy_total,
  case
    when coalesce(agg.games, 0) > 0 then coalesce(agg.total_points, 0) / agg.games
    else 0
  end as fantasy_ppg,
  tu.id as team_id
from public.players p
left join teams_unique tu on tu.name = p.team
left join agg on agg.player_id = p.id;

grant select on public.public_players to anon, authenticated;

commit;

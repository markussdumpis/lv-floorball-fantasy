begin;

create or replace view public.public_players as
select
  p.id,
  p.name,
  p.position,
  p.team,
  p.price_final as price,
  p.price_final,
  coalesce(agg.total_points, 0) as fantasy_total,
  case
    when coalesce(agg.games, 0) > 0 then coalesce(agg.total_points, 0) / agg.games
    else 0
  end as fantasy_ppg,
  t.id as team_id
from players p
left join teams t on t.name = p.team
left join (
  select
    player_id,
    count(distinct match_id) as games,
    sum(coalesce(fantasy_points, 0) + coalesce(fantasy_points_bonus, 0)) as total_points
  from player_match_points pmp
  join matches m on m.id = pmp.match_id
  where m.status = 'finished'
    and m.season = (
      select season
      from matches
      where status = 'finished' and season is not null
      order by date desc
      limit 1
    )
  group by player_id
) agg on agg.player_id = p.id;

grant select on public.public_players to anon, authenticated;

commit;

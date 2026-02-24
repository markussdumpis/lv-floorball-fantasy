begin;

create or replace view public.user_gameweeks_played_view as
with weekly_points as (
  select
    ft.user_id,
    mw.matchweek_number,
    sum(
      pmp.fantasy_points::numeric *
      case when cp.id is not null then 2::numeric else 1::numeric end
    ) as week_points
  from public.fantasy_teams ft
  join public.fantasy_team_players ftp
    on ftp.fantasy_team_id = ft.id
   and ftp.left_at is null
  join public.player_match_points pmp
    on pmp.player_id = ftp.player_id
  join public.matches_with_matchweek mw
    on mw.id = pmp.match_id
  left join public.fantasy_team_captain_periods cp
    on cp.fantasy_team_id = ft.id
   and cp.player_id = ftp.player_id
   and mw.date >= cp.starts_at
   and (cp.ends_at is null or mw.date < cp.ends_at)
  group by ft.user_id, mw.matchweek_number
)
select
  p.id as user_id,
  coalesce(
    count(distinct wp.matchweek_number) filter (where coalesce(wp.week_points, 0) > 0),
    0
  )::int as gameweeks_played
from public.profiles p
left join weekly_points wp on wp.user_id = p.id
group by p.id;

grant select on public.user_gameweeks_played_view to anon, authenticated;

commit;

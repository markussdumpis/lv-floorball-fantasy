begin;

create or replace view public.user_gameweeks_played_view as
with team_start as (
  select
    ft.id as fantasy_team_id,
    ft.user_id,
    coalesce(ft.created_at, min(ftp.joined_at)) as team_start_at
  from public.fantasy_teams ft
  left join public.fantasy_team_players ftp
    on ftp.fantasy_team_id = ft.id
  group by ft.id, ft.user_id, ft.created_at
),
participation as (
  select distinct
    ts.user_id,
    mw.matchweek_number
  from team_start ts
  join public.fantasy_team_players ftp
    on ftp.fantasy_team_id = ts.fantasy_team_id
  join public.player_match_points pmp
    on pmp.player_id = ftp.player_id
  join public.matches_with_matchweek mw
    on mw.id = pmp.match_id
  where ts.team_start_at is not null
    and mw.date >= ts.team_start_at
    and ftp.joined_at <= mw.date
    and (ftp.left_at is null or ftp.left_at > mw.date)
    and mw.status = 'finished'
)
select
  p.id as user_id,
  coalesce(count(distinct pr.matchweek_number), 0)::int as gameweeks_played
from public.profiles p
left join participation pr
  on pr.user_id = p.id
group by p.id;

grant select on public.user_gameweeks_played_view to anon, authenticated;

commit;

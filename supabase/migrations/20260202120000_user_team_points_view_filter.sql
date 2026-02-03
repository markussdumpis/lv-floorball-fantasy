begin;

create or replace view public.user_team_points_view as
with team_ids as (
  select ft.id as fantasy_team_id
  from public.fantasy_teams ft
  where ft.user_id = auth.uid()

  union

  select distinct ftp.fantasy_team_id
  from public.fantasy_team_players ftp
  join public.fantasy_teams ft on ft.id = ftp.fantasy_team_id
  where ft.user_id = auth.uid()
)
select
  t.fantasy_team_id,
  coalesce(sum(
    case
      when m.date is not null
        and ftp.joined_at is not null
        and m.date >= ftp.joined_at
        and (ftp.left_at is null or m.date < ftp.left_at)
      then pmp.fantasy_points::numeric *
        case when cp.id is not null then 2 else 1 end::numeric
      else 0::numeric
    end
  ), 0::numeric) as total_points
from team_ids t
left join public.fantasy_team_players ftp on ftp.fantasy_team_id = t.fantasy_team_id
left join public.player_match_points pmp on pmp.player_id = ftp.player_id
left join public.matches m on m.id = pmp.match_id
left join public.fantasy_team_captain_periods cp
  on cp.fantasy_team_id = t.fantasy_team_id
 and cp.player_id = ftp.player_id
 and m.date >= cp.starts_at
 and (cp.ends_at is null or m.date < cp.ends_at)
group by t.fantasy_team_id;

grant select on public.user_team_points_view to anon, authenticated;

commit;

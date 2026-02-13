begin;

-- Per-gameweek leaderboard with rank computed across all users.
create or replace function public.leaderboard_by_gameweek_data()
returns table (
  user_id uuid,
  gameweek_id uuid,
  points numeric,
  rank bigint
)
language sql
security definer
set search_path = public
as $$
with team_ids as (
  select ft.id as fantasy_team_id, ft.user_id, ft.gameweek_id
  from public.fantasy_teams ft

  union

  select distinct ftp.fantasy_team_id, ft.user_id, ft.gameweek_id
  from public.fantasy_team_players ftp
  join public.fantasy_teams ft on ft.id = ftp.fantasy_team_id
),
team_points as (
  select
    t.user_id,
    t.fantasy_team_id,
    t.gameweek_id,
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
  where t.gameweek_id is not null
  group by t.user_id, t.fantasy_team_id, t.gameweek_id
),
user_gameweek_points as (
  select
    user_id,
    gameweek_id,
    sum(total_points)::numeric as points
  from team_points
  group by user_id, gameweek_id
)
select
  ugp.user_id,
  ugp.gameweek_id,
  ugp.points,
  dense_rank() over (
    partition by ugp.gameweek_id
    order by ugp.points desc, ugp.user_id
  ) as rank
from user_gameweek_points ugp;
$$;

create or replace view public.leaderboard_by_gameweek as
select * from public.leaderboard_by_gameweek_data();

-- Distinct gameweeks where the user has a team entry.
create or replace view public.user_gameweeks_played as
select
  lbg.user_id,
  count(distinct lbg.gameweek_id)::int as gameweeks_played
from public.leaderboard_by_gameweek lbg
group by lbg.user_id;

grant execute on function public.leaderboard_by_gameweek_data() to anon, authenticated;
grant select on public.leaderboard_by_gameweek to anon, authenticated;
grant select on public.user_gameweeks_played to anon, authenticated;

commit;

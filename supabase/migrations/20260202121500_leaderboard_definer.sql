begin;

-- Security definer function to compute leaderboard bypassing per-row ownership filters,
-- but only returns aggregated fields (no team-level leakage).
create or replace function public.leaderboard_data()
returns table (
  user_id uuid,
  nickname text,
  season text,
  total_points numeric
)
language sql
security definer
set search_path = public
as $$
with team_ids as (
  select ft.id as fantasy_team_id, ft.user_id
  from public.fantasy_teams ft

  union

  select distinct ftp.fantasy_team_id, ft.user_id
  from public.fantasy_team_players ftp
  join public.fantasy_teams ft on ft.id = ftp.fantasy_team_id
),
team_points as (
  select
    t.user_id,
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
  group by t.user_id, t.fantasy_team_id
),
user_points as (
  select
    user_id,
    '2025-26'::text as season,
    sum(total_points)::numeric as total_points
  from team_points
  group by user_id
)
select
  p.id as user_id,
  p.nickname,
  up.season,
  coalesce(up.total_points, 0)::numeric as total_points
from public.profiles p
left join user_points up on up.user_id = p.id
where up.season is not null
order by coalesce(up.total_points, 0) desc, p.nickname nulls last, p.id;
$$;

-- Preserve existing REST surface.
create or replace view public.leaderboard as
select * from public.leaderboard_data();

grant execute on function public.leaderboard_data() to anon, authenticated;
grant select on public.leaderboard to anon, authenticated;

commit;

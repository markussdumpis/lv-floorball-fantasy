begin;

-- Base table for per-user season totals
create table if not exists public.user_season_points (
  user_id uuid not null references public.profiles (id) on delete cascade,
  season text not null,
  total_points numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, season)
);

-- Recompute totals from fantasy_team_players + player_match_points for a given season
create or replace function public.recompute_user_season_points(target_season text)
returns void
language plpgsql
as $$
begin
  insert into public.user_season_points (user_id, season, total_points, updated_at)
  select
    ft.user_id,
    target_season,
    coalesce(sum(pmp.fantasy_points::numeric + case when cp.id is not null then pmp.fantasy_points::numeric else 0 end), 0) as total_points,
    now()
  from public.fantasy_team_players ftp
  join public.fantasy_teams ft on ft.id = ftp.fantasy_team_id
  join public.player_match_points pmp on pmp.player_id = ftp.player_id
  join public.matches m on m.id = pmp.match_id
  left join public.fantasy_team_captain_periods cp
    on cp.fantasy_team_id = ftp.fantasy_team_id
   and cp.player_id = ftp.player_id
   and m.date >= cp.starts_at
   and (cp.ends_at is null or m.date < cp.ends_at)
  where m.status = 'finished'
    and m.season = target_season
    and m.date >= ftp.joined_at
    and (ftp.left_at is null or m.date < ftp.left_at)
  group by ft.user_id
  on conflict (user_id, season) do update
    set total_points = excluded.total_points,
        updated_at = now();
end;
$$;

comment on function public.recompute_user_season_points is 'Recompute per-user fantasy points for a season from fantasy_team_players and player_match_points (captain bonus included)';

commit;

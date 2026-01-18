begin;

drop view if exists public.fantasy_team_match_points;
drop view if exists public.player_match_points;

create table if not exists public.player_match_points (
  id uuid primary key default gen_random_uuid(),

  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,

  -- Fantasy position at match time (A = attacker, D = defender, V = goalie)
  position text not null,

  -- Raw counting stats for debugging and transparency
  goals integer not null default 0,
  assists integer not null default 0,
  shots_on_goal integer not null default 0,
  pen_min integer not null default 0,
  saves integer not null default 0,
  goals_against integer not null default 0,

  -- Special flags/bonuses
  hat_trick boolean not null default false,
  game_winner boolean not null default false,
  clean_sheet boolean not null default false,

  -- Fantasy scoring outputs
  fantasy_points numeric(10,2) not null default 0,        -- total points for this match
  fantasy_points_base numeric(10,2) not null default 0,   -- base points from goals, assists, etc.
  fantasy_points_bonus numeric(10,2) not null default 0,  -- bonus points (hattrick, GWG, clean sheet, etc.)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per player per match
create unique index if not exists idx_player_match_points_unique
  on public.player_match_points (match_id, player_id);

create or replace view public.fantasy_team_match_points as
select
  fr.team_id,
  ft.user_id,
  ft.gameweek_id,
  pmp.match_id,
  sum(case when fr.is_captain then pmp.fantasy_points * 2 else pmp.fantasy_points end) as points
from fantasy_rosters fr
join fantasy_teams ft on ft.id = fr.team_id
join player_match_points pmp on pmp.player_id = fr.player_id
group by fr.team_id, ft.user_id, ft.gameweek_id, pmp.match_id;

commit;

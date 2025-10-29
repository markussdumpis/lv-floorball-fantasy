begin;

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'event_type') then
    create type event_type as enum (
      'goal',
      'assist',
      'hat_trick',
      'penalty_shot_scored',
      'penalty_shot_missed',
      'minor_2',
      'double_minor',
      'red_card',
      'mvp',
      'save',
      'goal_allowed'
    );
  end if;
end $$;

create table if not exists gameweeks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists fantasy_teams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  budget numeric(8,2) not null default 100,
  gameweek_id uuid references gameweeks (id),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists fantasy_rosters (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references fantasy_teams (id) on delete cascade,
  player_id uuid not null references players (id),
  position text not null,
  is_captain boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists fantasy_transfers (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references fantasy_teams (id) on delete cascade,
  player_in_id uuid references players (id),
  player_out_id uuid references players (id),
  gameweek_id uuid references gameweeks (id),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  home_team text not null,
  away_team text not null,
  home_score integer default 0,
  away_score integer default 0,
  start_time timestamptz not null,
  season text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches (id) on delete cascade,
  player_id uuid not null references players (id),
  event_type event_type not null,
  value numeric default 0,
  minute integer,
  created_at timestamptz not null default timezone('utc', now())
);

create or replace view public.public_players as
select
  id,
  name,
  position,
  team,
  price,
  fppg
from public.players;

grant select on public.public_players to anon, authenticated;

create or replace view public.player_match_points as
select
  me.match_id,
  me.player_id,
  sum(
    case me.event_type
      when 'goal' then 5
      when 'assist' then 3
      when 'hat_trick' then 5
      when 'penalty_shot_scored' then 2
      when 'penalty_shot_missed' then -2
      when 'minor_2' then -1
      when 'double_minor' then -2
      when 'red_card' then -5
      when 'mvp' then 5
      when 'save' then 0.1
      when 'goal_allowed' then -1
      else 0
    end
  ) as points
from match_events me
group by me.match_id, me.player_id;

create or replace view public.fantasy_team_match_points as
select
  fr.team_id,
  ft.user_id,
  ft.gameweek_id,
  pmp.match_id,
  sum(case when fr.is_captain then pmp.points * 2 else pmp.points end) as points
from fantasy_rosters fr
join fantasy_teams ft on ft.id = fr.team_id
join player_match_points pmp on pmp.player_id = fr.player_id
group by fr.team_id, ft.user_id, ft.gameweek_id, pmp.match_id;

create unique index if not exists fantasy_rosters_captain_unique on fantasy_rosters (team_id)
  where is_captain is true;

alter table fantasy_teams enable row level security;
alter table fantasy_rosters enable row level security;
alter table fantasy_transfers enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fantasy_teams' and policyname = 'Users manage own teams'
  ) then
    create policy "Users manage own teams" on fantasy_teams
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fantasy_rosters' and policyname = 'Users manage own rosters'
  ) then
    create policy "Users manage own rosters" on fantasy_rosters
      using (team_id in (select id from fantasy_teams where user_id = auth.uid()))
      with check (team_id in (select id from fantasy_teams where user_id = auth.uid()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fantasy_transfers' and policyname = 'Users manage own transfers'
  ) then
    create policy "Users manage own transfers" on fantasy_transfers
      using (team_id in (select id from fantasy_teams where user_id = auth.uid()))
      with check (team_id in (select id from fantasy_teams where user_id = auth.uid()));
  end if;
end $$;

commit;

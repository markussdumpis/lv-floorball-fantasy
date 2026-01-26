-- Add roster windows, captain cooldown tracking, captain periods, and RPC

-- 1) Roster window columns
alter table public.fantasy_team_players
  add column if not exists joined_at timestamptz not null default now(),
  add column if not exists left_at timestamptz null,
  add column if not exists captain_from timestamptz null,
  add column if not exists captain_to timestamptz null;

update public.fantasy_team_players
  set joined_at = coalesce(joined_at, created_at, now())
where joined_at is null;

create index if not exists ftp_team_left_idx on public.fantasy_team_players (fantasy_team_id, left_at);
create index if not exists ftp_team_player_idx on public.fantasy_team_players (fantasy_team_id, player_id);
create unique index if not exists ftp_team_captain_active_idx
  on public.fantasy_team_players (fantasy_team_id)
  where is_captain is true and left_at is null;

-- 2) Captain metadata on teams
alter table public.fantasy_teams
  add column if not exists captain_changed_at timestamptz null,
  add column if not exists captain_player_id uuid references public.players(id);

-- 3) Captain periods table
create table if not exists public.fantasy_team_captain_periods (
  id uuid primary key default gen_random_uuid(),
  fantasy_team_id uuid not null references public.fantasy_teams(id) on delete cascade,
  player_id uuid not null references public.players(id),
  starts_at timestamptz not null default now(),
  ends_at timestamptz null,
  created_at timestamptz not null default now()
);

alter table public.fantasy_team_captain_periods enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'fantasy_team_captain_periods' and policyname = 'Select own captain periods') then
    create policy "Select own captain periods" on public.fantasy_team_captain_periods
      for select using (
        exists (
          select 1 from public.fantasy_teams t
          where t.id = fantasy_team_id and t.user_id = auth.uid()
        )
      );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'fantasy_team_captain_periods' and policyname = 'Insert own captain periods') then
    create policy "Insert own captain periods" on public.fantasy_team_captain_periods
      for insert with check (
        exists (
          select 1 from public.fantasy_teams t
          where t.id = fantasy_team_id and t.user_id = auth.uid()
        )
      );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'fantasy_team_captain_periods' and policyname = 'Update own captain periods') then
    create policy "Update own captain periods" on public.fantasy_team_captain_periods
      for update using (
        exists (
          select 1 from public.fantasy_teams t
          where t.id = fantasy_team_id and t.user_id = auth.uid()
        )
      );
  end if;
end $$;

create index if not exists ftcp_team_ends_idx on public.fantasy_team_captain_periods (fantasy_team_id, ends_at);
create index if not exists ftcp_team_starts_idx on public.fantasy_team_captain_periods (fantasy_team_id, starts_at);

-- 4) RPC for captain change with 30-day cooldown
create or replace function public.set_captain(p_team_id uuid, p_player_id uuid)
returns json as $$
declare
  owner_id uuid;
  last_change timestamptz;
  lock_until timestamptz;
  now_ts timestamptz := now();
begin
  select user_id, captain_changed_at into owner_id, last_change
  from public.fantasy_teams
  where id = p_team_id;

  if owner_id is null or owner_id <> auth.uid() then
    raise exception 'Not authorized to modify this team';
  end if;

  if last_change is not null then
    lock_until := last_change + interval '30 days';
    if now_ts < lock_until then
      raise exception 'CAPTAIN_COOLDOWN' using detail = lock_until::text;
    end if;
  end if;

  if not exists (
    select 1 from public.fantasy_team_players
    where fantasy_team_id = p_team_id
      and player_id = p_player_id
      and left_at is null
  ) then
    raise exception 'Player not on this team or not active';
  end if;

  -- Close active captain period
  update public.fantasy_team_captain_periods
     set ends_at = now_ts
   where fantasy_team_id = p_team_id
     and ends_at is null;

  -- Open new period
  insert into public.fantasy_team_captain_periods(fantasy_team_id, player_id, starts_at)
  values (p_team_id, p_player_id, now_ts);

  -- Update roster flags
  update public.fantasy_team_players
     set is_captain = false,
         captain_to = now_ts
   where fantasy_team_id = p_team_id
     and left_at is null;

  update public.fantasy_team_players
     set is_captain = true,
         captain_from = coalesce(captain_from, now_ts),
         captain_to = null
   where fantasy_team_id = p_team_id
     and left_at is null
     and player_id = p_player_id;

  update public.fantasy_teams
     set captain_player_id = p_player_id,
         captain_changed_at = now_ts
   where id = p_team_id;

  return json_build_object('ok', true, 'captain_player_id', p_player_id, 'next_change_at', now_ts + interval '30 days');
end;
$$ language plpgsql security definer;

grant execute on function public.set_captain(uuid, uuid) to authenticated;

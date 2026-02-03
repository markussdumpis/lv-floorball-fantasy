begin;

-- Enable RLS on public, read-only ingest tables (idempotent).
do $$
begin
  alter table if exists public.teams enable row level security;
  alter table if exists public.matches enable row level security;
  alter table if exists public.players enable row level security;
  alter table if exists public.match_events enable row level security;
  alter table if exists public.player_match_points enable row level security;
  alter table if exists public.match_goalie_stats enable row level security;
end
$$;

-- SELECT-only policy for public.teams
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'teams'
  ) and not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'teams' and policyname = 'Allow read access to all users'
  ) then
    create policy "Allow read access to all users" on public.teams
      for select
      using (true);
  end if;
end
$$;

-- SELECT-only policy for public.matches
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'matches'
  ) and not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'matches' and policyname = 'Allow read access to all users'
  ) then
    create policy "Allow read access to all users" on public.matches
      for select
      using (true);
  end if;
end
$$;

-- SELECT-only policy for public.players
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'players'
  ) and not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'players' and policyname = 'Allow read access to all users'
  ) then
    create policy "Allow read access to all users" on public.players
      for select
      using (true);
  end if;
end
$$;

-- SELECT-only policy for public.match_events
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'match_events'
  ) and not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'match_events' and policyname = 'Allow read access to all users'
  ) then
    create policy "Allow read access to all users" on public.match_events
      for select
      using (true);
  end if;
end
$$;

-- SELECT-only policy for public.player_match_points
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'player_match_points'
  ) and not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'player_match_points' and policyname = 'Allow read access to all users'
  ) then
    create policy "Allow read access to all users" on public.player_match_points
      for select
      using (true);
  end if;
end
$$;

-- SELECT-only policy for public.match_goalie_stats
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'match_goalie_stats'
  ) and not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'match_goalie_stats' and policyname = 'Allow read access to all users'
  ) then
    create policy "Allow read access to all users" on public.match_goalie_stats
      for select
      using (true);
  end if;
end
$$;

commit;

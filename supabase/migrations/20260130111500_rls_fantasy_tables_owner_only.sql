begin;

-- Ensure RLS is on for user-owned fantasy tables.
do $$
begin
  alter table if exists public.fantasy_teams enable row level security;
  alter table if exists public.fantasy_team_players enable row level security;
  alter table if exists public.fantasy_team_captain_periods enable row level security;
end
$$;

-- Policies for public.fantasy_teams (owner = user_id).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'fantasy_teams') then
    -- Select own teams
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'fantasy_teams' and policyname = 'Select own fantasy teams'
    ) then
      create policy "Select own fantasy teams" on public.fantasy_teams
        for select using (auth.uid() = user_id);
    end if;

    -- Insert own teams
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'fantasy_teams' and policyname = 'Insert own fantasy teams'
    ) then
      create policy "Insert own fantasy teams" on public.fantasy_teams
        for insert with check (auth.uid() = user_id);
    end if;

    -- Update own teams
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'fantasy_teams' and policyname = 'Update own fantasy teams'
    ) then
      create policy "Update own fantasy teams" on public.fantasy_teams
        for update using (auth.uid() = user_id)
        with check (auth.uid() = user_id);
    end if;

    -- Delete own teams (optional but safe)
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'fantasy_teams' and policyname = 'Delete own fantasy teams'
    ) then
      create policy "Delete own fantasy teams" on public.fantasy_teams
        for delete using (auth.uid() = user_id);
    end if;
  end if;
end
$$;

-- Policies for public.fantasy_team_players (owner via team -> user_id).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'fantasy_team_players') then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'fantasy_team_players' and policyname = 'Select own fantasy team players'
    ) then
      create policy "Select own fantasy team players" on public.fantasy_team_players
        for select using (
          exists (
            select 1 from public.fantasy_teams ft
            where ft.id = fantasy_team_id and ft.user_id = auth.uid()
          )
        );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'fantasy_team_players' and policyname = 'Insert own fantasy team players'
    ) then
      create policy "Insert own fantasy team players" on public.fantasy_team_players
        for insert with check (
          exists (
            select 1 from public.fantasy_teams ft
            where ft.id = fantasy_team_id and ft.user_id = auth.uid()
          )
        );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'fantasy_team_players' and policyname = 'Update own fantasy team players'
    ) then
      create policy "Update own fantasy team players" on public.fantasy_team_players
        for update using (
          exists (
            select 1 from public.fantasy_teams ft
            where ft.id = fantasy_team_id and ft.user_id = auth.uid()
          )
        )
        with check (
          exists (
            select 1 from public.fantasy_teams ft
            where ft.id = fantasy_team_id and ft.user_id = auth.uid()
          )
        );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'fantasy_team_players' and policyname = 'Delete own fantasy team players'
    ) then
      create policy "Delete own fantasy team players" on public.fantasy_team_players
        for delete using (
          exists (
            select 1 from public.fantasy_teams ft
            where ft.id = fantasy_team_id and ft.user_id = auth.uid()
          )
        );
    end if;
  end if;
end
$$;

-- Policies for public.fantasy_team_captain_periods (owner via team -> user_id).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'fantasy_team_captain_periods') then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'fantasy_team_captain_periods' and policyname = 'Select own captain periods'
    ) then
      create policy "Select own captain periods" on public.fantasy_team_captain_periods
        for select using (
          exists (
            select 1 from public.fantasy_teams ft
            where ft.id = fantasy_team_id and ft.user_id = auth.uid()
          )
        );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'fantasy_team_captain_periods' and policyname = 'Insert own captain periods'
    ) then
      create policy "Insert own captain periods" on public.fantasy_team_captain_periods
        for insert with check (
          exists (
            select 1 from public.fantasy_teams ft
            where ft.id = fantasy_team_id and ft.user_id = auth.uid()
          )
        );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'fantasy_team_captain_periods' and policyname = 'Update own captain periods'
    ) then
      create policy "Update own captain periods" on public.fantasy_team_captain_periods
        for update using (
          exists (
            select 1 from public.fantasy_teams ft
            where ft.id = fantasy_team_id and ft.user_id = auth.uid()
          )
        )
        with check (
          exists (
            select 1 from public.fantasy_teams ft
            where ft.id = fantasy_team_id and ft.user_id = auth.uid()
          )
        );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'fantasy_team_captain_periods' and policyname = 'Delete own captain periods'
    ) then
      create policy "Delete own captain periods" on public.fantasy_team_captain_periods
        for delete using (
          exists (
            select 1 from public.fantasy_teams ft
            where ft.id = fantasy_team_id and ft.user_id = auth.uid()
          )
        );
    end if;
  end if;
end
$$;

commit;

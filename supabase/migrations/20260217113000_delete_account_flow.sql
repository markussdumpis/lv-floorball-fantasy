begin;

create table if not exists public.deleted_user_season_summaries (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  total_points integer,
  deleted_at timestamptz not null default now()
);

alter table public.deleted_user_season_summaries enable row level security;

create or replace function public.delete_user_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_team_ids uuid[] := '{}';
  v_user_season_points_is_table boolean := false;
  v_leaderboard_is_table boolean := false;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  -- Optional anonymized analytics snapshot. No identifiers are written.
  insert into public.deleted_user_season_summaries (season, total_points)
  select
    usp.season,
    round(coalesce(usp.total_points, 0))::integer as total_points
  from public.user_season_points usp
  where usp.user_id = p_user_id;

  select coalesce(array_agg(ft.id), '{}')
  into v_team_ids
  from public.fantasy_teams ft
  where ft.user_id = p_user_id;

  if cardinality(v_team_ids) > 0 then
    delete from public.fantasy_team_players
    where fantasy_team_id = any(v_team_ids);

    delete from public.fantasy_team_captain_periods
    where fantasy_team_id = any(v_team_ids);
  end if;

  delete from public.fantasy_teams
  where user_id = p_user_id;

  -- Some environments may materialize these as tables; others keep them as views.
  select exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'leaderboard'
      and c.relkind = 'r'
  ) into v_leaderboard_is_table;

  if v_leaderboard_is_table then
    execute 'delete from public.leaderboard where user_id = $1' using p_user_id;
  end if;

  select exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'user_season_points'
      and c.relkind = 'r'
  ) into v_user_season_points_is_table;

  if v_user_season_points_is_table then
    execute 'delete from public.user_season_points where user_id = $1' using p_user_id;
  end if;

  delete from public.profiles
  where id = p_user_id;
end;
$$;

revoke all on function public.delete_user_data(uuid) from public;
grant execute on function public.delete_user_data(uuid) to service_role;

commit;

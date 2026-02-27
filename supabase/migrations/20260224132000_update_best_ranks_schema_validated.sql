begin;

create or replace function public.update_best_ranks()
returns table (updated_rows int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int := 0;
  has_leaderboard_user_id boolean := false;
  has_leaderboard_total_points boolean := false;
  has_profiles_id boolean := false;
  has_profiles_best_rank boolean := false;
  has_profiles_best_rank_updated_at boolean := false;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leaderboard'
      and column_name = 'user_id'
  ) into has_leaderboard_user_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leaderboard'
      and column_name = 'total_points'
  ) into has_leaderboard_total_points;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'id'
  ) into has_profiles_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'best_rank'
  ) into has_profiles_best_rank;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'best_rank_updated_at'
  ) into has_profiles_best_rank_updated_at;

  if not has_leaderboard_user_id or not has_leaderboard_total_points then
    raise exception 'update_best_ranks(): leaderboard must expose user_id and total_points';
  end if;

  if not has_profiles_id or not has_profiles_best_rank or not has_profiles_best_rank_updated_at then
    raise exception 'update_best_ranks(): profiles must expose id, best_rank, best_rank_updated_at';
  end if;

  with ranked as (
    select
      l.user_id,
      rank() over (order by l.total_points desc, l.user_id asc)::int as current_rank
    from public.leaderboard l
    where l.user_id is not null
  ),
  updated as (
    update public.profiles p
    set
      best_rank = least(coalesce(p.best_rank, r.current_rank), r.current_rank),
      best_rank_updated_at = case
        when p.best_rank is null or r.current_rank < p.best_rank then now()
        else p.best_rank_updated_at
      end
    from ranked r
    where p.id = r.user_id
      and (p.best_rank is null or r.current_rank < p.best_rank)
    returning 1
  )
  select count(*)::int into v_updated from updated;

  return query select v_updated;
end;
$$;

revoke all on function public.update_best_ranks() from public;
grant execute on function public.update_best_ranks() to service_role;

commit;

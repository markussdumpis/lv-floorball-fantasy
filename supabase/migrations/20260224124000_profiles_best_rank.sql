begin;

alter table public.profiles
  add column if not exists best_rank int,
  add column if not exists best_rank_updated_at timestamptz;

create or replace function public.update_best_ranks()
returns table (updated_rows int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int := 0;
begin
  with ranked as (
    select
      l.user_id,
      rank() over (order by l.total_points desc, l.user_id asc)::int as current_rank
    from public.leaderboard l
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

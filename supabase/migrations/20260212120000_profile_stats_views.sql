begin;

-- Per-gameweek leaderboard with rank computed across all users.
create or replace function public.leaderboard_by_gameweek_data()
returns table (
  user_id uuid,
  gameweek_id uuid,
  points numeric,
  rank bigint
)
language sql
security definer
set search_path = public
as $$
select
  l.user_id,
  null::uuid as gameweek_id,
  l.total_points as points,
  rank() over (
    partition by l.season
    order by l.total_points desc
  ) as rank
from public.leaderboard l;
$$;

create or replace view public.leaderboard_by_gameweek as
select
  *
from public.leaderboard_by_gameweek_data();

-- Distinct gameweeks where the user has a team entry.
create or replace view public.user_gameweeks_played as
select
  lbg.user_id,
  count(distinct lbg.gameweek_id)::int as gameweeks_played
from public.leaderboard_by_gameweek lbg
group by lbg.user_id;

grant execute on function public.leaderboard_by_gameweek_data() to anon, authenticated;
grant select on public.leaderboard_by_gameweek to anon, authenticated;
grant select on public.user_gameweeks_played to anon, authenticated;

commit;

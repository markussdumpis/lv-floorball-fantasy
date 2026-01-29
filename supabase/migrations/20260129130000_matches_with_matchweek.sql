begin;

create or replace view public.matches_with_matchweek as
with base as (
  select
    m.*,
    date_trunc('week', (m.date at time zone 'Europe/Riga'))::date as matchweek_start_date
  from public.matches m
)
, with_season_start as (
  select
    b.*,
    min(b.matchweek_start_date) over (partition by b.season) as season_week1_start_date
  from base b
)
select
  w.*,
  (1 + ((w.matchweek_start_date - w.season_week1_start_date) / 7))::int as matchweek_number
from with_season_start w;

grant select on public.matches_with_matchweek to anon, authenticated;

commit;

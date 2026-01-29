begin;

-- Teams that play today (Europe/Riga calendar day)
create or replace view public.locked_teams_today as
select distinct team_id
from (
  select home_team as team_id, date
  from matches
  union all
  select away_team as team_id, date
  from matches
) t
where date is not null
  and (date at time zone 'Europe/Riga')::date = (now() at time zone 'Europe/Riga')::date
  and team_id is not null;

-- Players whose team is locked today
create or replace view public.locked_players_today as
select distinct p.id as player_id
from public.public_players p
join public.locked_teams_today lt on lt.team_id = p.team_id;

grant select on public.locked_teams_today to anon, authenticated;
grant select on public.locked_players_today to anon, authenticated;

commit;

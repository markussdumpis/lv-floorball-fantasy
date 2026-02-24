-- Keep historical roster rows, but enforce uniqueness for active roster rows only.

-- Safety cleanup: if legacy data contains duplicate active rows for same team/player,
-- close older rows so the partial unique index can be created.
with ranked as (
  select
    id,
    row_number() over (
      partition by fantasy_team_id, player_id
      order by joined_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.fantasy_team_players
  where left_at is null
)
update public.fantasy_team_players ftp
set
  left_at = now(),
  is_captain = false,
  captain_to = coalesce(captain_to, now())
from ranked r
where ftp.id = r.id
  and r.rn > 1;

create unique index if not exists fantasy_team_players_active_unique
  on public.fantasy_team_players (fantasy_team_id, player_id)
  where left_at is null;

create or replace view public.fantasy_team_players_active as
select *
from public.fantasy_team_players
where left_at is null;

grant select on public.fantasy_team_players_active to authenticated;

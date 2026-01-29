-- View: user_team_player_points_view
-- Shows active roster players with points limited to their membership window and captain bonus windows.

create or replace view public.user_team_player_points_view as
with roster as (
  select
    fantasy_team_id,
    player_id,
    joined_at,
    left_at,
    is_captain
  from public.fantasy_team_players
  where left_at is null
)
select
  r.fantasy_team_id,
  r.player_id,
  pp.name,
  pp.position,
  pp.team,
  coalesce(sum(
    case
      when m.date is not null
       and m.date >= r.joined_at
       and (r.left_at is null or m.date < r.left_at)
      then pmp.fantasy_points::numeric
      else 0
    end
  ), 0) as base_points,
  coalesce(sum(
    case
      when m.date is not null
       and m.date >= r.joined_at
       and (r.left_at is null or m.date < r.left_at)
       and cp.id is not null
      then pmp.fantasy_points::numeric
      else 0
    end
  ), 0) as captain_bonus,
  coalesce(sum(
    case
      when m.date is not null
       and m.date >= r.joined_at
       and (r.left_at is null or m.date < r.left_at)
      then pmp.fantasy_points::numeric
      else 0
    end
  ), 0)
  +
  coalesce(sum(
    case
      when m.date is not null
       and m.date >= r.joined_at
       and (r.left_at is null or m.date < r.left_at)
       and cp.id is not null
      then pmp.fantasy_points::numeric
      else 0
    end
  ), 0) as total_points
from roster r
join public.public_players pp on pp.id = r.player_id
left join public.player_match_points pmp on pmp.player_id = r.player_id
left join public.matches m on m.id = pmp.match_id
left join public.fantasy_team_captain_periods cp
  on cp.fantasy_team_id = r.fantasy_team_id
  and cp.player_id = r.player_id
  and m.date >= cp.starts_at
  and (cp.ends_at is null or m.date < cp.ends_at)
group by r.fantasy_team_id, r.player_id, pp.name, pp.position, pp.team;

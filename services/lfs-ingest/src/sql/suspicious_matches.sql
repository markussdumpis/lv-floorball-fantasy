-- Suspicious finished matches in the last :days days
-- Flags matches with zero or unusually low goal events relative to scoreboard
-- Parameters: :days integer number of days to look back from now()

with finished as (
  select
    m.id,
    m.external_id,
    m.date,
    m.home_score,
    m.away_score,
    coalesce(m.home_score, 0) + coalesce(m.away_score, 0) as total_goals,
    m.season
  from matches m
  where m.status = 'finished'
    and m.date >= now() - (:days || ' days')::interval
),
events as (
  select me.match_id,
         count(*) filter (where me.event_type = 'goal') as goal_events,
         count(*) as total_events
  from match_events me
  group by me.match_id
),
pmp as (
  select pmp.match_id,
         count(*) as player_match_points_rows
  from player_match_points pmp
  group by pmp.match_id
)
select
  f.id as match_id,
  f.external_id,
  f.date,
  f.home_score,
  f.away_score,
  f.total_goals,
  coalesce(e.goal_events, 0) as goal_events,
  coalesce(e.total_events, 0) as total_events,
  coalesce(p.player_match_points_rows, 0) as player_match_points_rows,
  case
    when coalesce(e.total_events, 0) = 0 then 'missing_all_events'
    when f.total_goals > 0 and coalesce(e.goal_events, 0) < f.total_goals then 'goal_count_lt_score'
    when f.total_goals = 0 and coalesce(e.total_events, 0) = 0 then 'zero_score_zero_events'
    else 'ok'
  end as flag
from finished f
left join events e on e.match_id = f.id
left join pmp p on p.match_id = f.id
where coalesce(e.total_events, 0) = 0
   or (f.total_goals > 0 and coalesce(e.goal_events, 0) < f.total_goals)
order by f.date asc;

# Data Sanity Checks

Quick SQL snippets to confirm ingest isn’t creating junk players or wiring bad assists.

## Players with no games

```sql
-- Expectation: 0 rows; investigate any recent inserts without stats.
select id, name, team_id, created_at
from players
where games is null
order by created_at desc
limit 50;
```

## Recent players with no team

```sql
-- Expectation: 0 rows; new inserts should always have team_id.
select id, name, team_id, created_at
from players
where team_id is null
  and created_at >= now() - interval '7 days'
order by created_at desc;
```

## Assists filtered as junk (assist_id null)

```sql
-- Expectation: Rows may exist; assist_id should stay null for junk text.
select id, match_id, player_id, assist_id, raw
from match_events
where event_type = 'goal'
  and assist_id is null
  and (
    raw ->> 'assist_raw' ilike '%soda laika%'
    or raw ->> 'assist_raw' ilike '%nepilnos sastavos%'
  )
order by created_at desc
limit 50;
```

## Player names containing junk keywords

```sql
-- Expectation: 0 rows; any hits should be cleaned up.
select id, name, team_id, created_at
from players
where name ilike '%soda laika%'
   or name ilike '%nepilnos sastavos%'
order by created_at desc;
```

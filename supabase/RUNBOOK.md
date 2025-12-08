# Supabase Pricing + Position Normalization Runbook

Follow the steps below to reconcile player stats, positions, and pricing inside Supabase. Each step can be run either by copying the SQL from the repo file (recommended) or by pasting the inline block provided here directly into the SQL Editor.

## Prerequisites
- Login to the Supabase dashboard for the `lv-floorball-fantasy` project.
- Navigate to **SQL Editor → New query**.

## Step 01 – Add missing stat columns
- File: `supabase/sql/01_add_stats_columns.sql`
- Purpose: Ensure the `public.players` table has the required stat and pricing columns.

```sql
-- Adds stat tracking and pricing columns to players in an idempotent way.
alter table if exists public.players
  add column if not exists games integer default 0,
  add column if not exists points numeric(10,2) default 0,
  add column if not exists saves integer default 0,
  add column if not exists save_pct numeric(5,2) default 0,
  add column if not exists price_raw numeric(12,2) default 0,
  add column if not exists price_final numeric(12,1) default 0;
```

## Step 02 – Initialize NULL stats
- File: `supabase/sql/02_init_missing_stats.sql`
- Purpose: Guard against NULL stat values before calculations.

```sql
-- Normalizes NULL player stat fields to zero for safe downstream calculations.
update public.players
set
  games = coalesce(games, 0),
  points = coalesce(points, 0),
  saves = coalesce(saves, 0),
  save_pct = coalesce(save_pct, 0),
  price_raw = coalesce(price_raw, 0),
  price_final = coalesce(price_final, 0)
where games is null
   or points is null
   or saves is null
   or save_pct is null
   or price_raw is null
   or price_final is null;
```

## Step 03 – Normalize positions
- File: `supabase/sql/03_normalize_positions.sql`
- Purpose: Convert legacy positions to `U/A/V`, infer missing goalies, and default the rest to attackers.

```sql
-- Harmonizes legacy player positions to the new U/A/V scheme.
-- Phase 1: map legacy codes and clear anything unknown.
update public.players
set position = case
  when position in ('U', 'A', 'V') then position
  when position = 'F' then 'U'
  when position = 'D' then 'A'
  when position = 'G' then 'V'
  else null
end
where position is not null
  and position <> case
    when position in ('U', 'A', 'V') then position
    when position = 'F' then 'U'
    when position = 'D' then 'A'
    when position = 'G' then 'V'
    else null
  end;

-- Phase 2: auto-assign goalies when save stats exist.
update public.players
set position = 'V'
where position is null
  and (coalesce(saves, 0) > 0 or coalesce(save_pct, 0) > 0);

-- Phase 3: default any remaining NULL positions to attacker (U).
update public.players
set position = 'U'
where position is null;
```

## Step 04 – Enforce the position check constraint
- File: `supabase/sql/04_enforce_position_check.sql`
- Purpose: Lock in the `U/A/V` restriction and fail fast if anything unexpected remains.

```sql
-- Recreates the positional check constraint to enforce U/A/V values only.
alter table if exists public.players
  drop constraint if exists players_position_check;

alter table if exists public.players
  add constraint players_position_check
  check (position in ('U', 'A', 'V'));

-- If the constraint fails during execution, inspect offending rows with:
-- select id, name, position from public.players where position not in ('U', 'A', 'V') or position is null;
```

> 💡 **Constraint failure?** Run the diagnostic query (last comment above), clean up any outliers manually, and re-run this step.

## Step 05 – Recompute raw prices
- File: `supabase/sql/05_recompute_prices.sql`
- Purpose: Refresh `price_raw` using the latest stats.

```sql
-- (Re)defines a helper to recompute player price_raw from base stats.
-- Reset any legacy routine signature before redefining.
drop function if exists public.recompute_prices();
drop procedure if exists public.recompute_prices();

create or replace procedure public.recompute_prices()
language plpgsql
as $$
begin
  update public.players
  set price_raw = greatest(
    0,
    coalesce(points, 0) * 1.0
      + coalesce(games, 0) * 0.05
      + case
          when position = 'V' then coalesce(saves, 0) * 0.02 + coalesce(save_pct, 0) * 0.05
          else 0
        end
  );
end;
$$;

-- Execute the recalculation immediately.
call public.recompute_prices();
```

## Step 06 – Rescale prices by position
- File: `supabase/sql/06_rescale_prices_by_position.sql`
- Purpose: Convert `price_raw` into the final “millions” banded pricing.
- Tweak constants (`u_min`, `u_max`, etc.) as needed before running.

```sql
-- Rescales price_raw into position-specific bands and stores the result in price_final.
do $$
declare
  u_min constant numeric := 4.0;
  u_max constant numeric := 15.0;
  a_min constant numeric := 3.5;
  a_max constant numeric := 13.0;
  v_min constant numeric := 5.0;
  v_max constant numeric := 18.0;
begin
  with constants as (
    select 'U'::text as position, u_min as target_min, u_max as target_max
    union all
    select 'A', a_min, a_max
    union all
    select 'V', v_min, v_max
  ),
  raw_stats as (
    select
      position,
      min(price_raw) as raw_min,
      max(price_raw) as raw_max
    from public.players
    where position in ('U', 'A', 'V')
    group by position
  ),
  new_prices as (
    select
      p.id,
      p.position,
      c.target_min,
      c.target_max,
      case
        when r.raw_min is null or r.raw_max is null or r.raw_max = r.raw_min then c.target_min
        else c.target_min
          + (c.target_max - c.target_min)
          * (p.price_raw - r.raw_min)
          / nullif(r.raw_max - r.raw_min, 0)
      end as scaled_value
    from public.players p
    join constants c on c.position = p.position
    left join raw_stats r on r.position = p.position
    where p.position in ('U', 'A', 'V')
  )
  update public.players p
  set price_final = round(
    greatest(
      np.target_min,
      least(np.target_max, coalesce(np.scaled_value, np.target_min))
    ),
    1
  )
  from new_prices np
  where p.id = np.id;
end;
$$;
```

## Step 07 – Verify results
- File: `supabase/sql/07_verify.sql`
- Purpose: Double-check counts and pricing sanity.

```sql
-- Quick sanity checks after applying the pricing pipeline.

-- 1) Player counts per position
select position, count(*) as player_count
from public.players
group by position
order by position;

-- 2) Price distribution per position
select
  position,
  min(price_final) as min_price,
  avg(price_final) as avg_price,
  max(price_final) as max_price
from public.players
where position in ('U', 'A', 'V')
group by position
order by position;

-- 3) Top 10 most expensive players
select
  name,
  team,
  position,
  price_final
from public.players
order by price_final desc, name
limit 10;
```

Once the verification queries look healthy (no rogue positions, prices sit inside the configured bands, and the top 10 feels reasonable), the pricing refresh is complete.

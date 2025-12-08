-- Recreates the positional check constraint to enforce U/A/V values only.
alter table if exists public.players
  drop constraint if exists players_position_check;

alter table if exists public.players
  add constraint players_position_check
  check (position in ('U', 'A', 'V'));

-- If the constraint fails during execution, inspect offending rows with:
-- select id, name, position from public.players where position not in ('U', 'A', 'V') or position is null;

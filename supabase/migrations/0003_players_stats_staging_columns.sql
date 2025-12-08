begin;

alter table if exists public.players_stats_staging
  add column if not exists goals integer,
  add column if not exists assists integer,
  add column if not exists penalty_min integer;

commit;

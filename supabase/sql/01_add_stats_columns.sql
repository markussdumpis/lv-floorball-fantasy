-- Adds stat tracking and pricing columns to players in an idempotent way.
alter table if exists public.players
  add column if not exists games integer default 0,
  add column if not exists points numeric(10,2) default 0,
  add column if not exists saves integer default 0,
  add column if not exists save_pct numeric(5,2) default 0,
  add column if not exists price_raw numeric(12,2) default 0,
  add column if not exists price_final numeric(12,1) default 0;

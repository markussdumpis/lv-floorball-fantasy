begin;

alter table if exists public.players
  add column if not exists price_computed numeric,
  add column if not exists price_manual numeric,
  add column if not exists price_final numeric;

create or replace function public.compute_player_price(
  position text,
  points numeric,
  games numeric,
  save_pct numeric,
  saves numeric,
  pen_min numeric
) returns numeric as $$
declare
  ppg numeric := nullif(points, 0) / nullif(games, 0);
  spg numeric := nullif(saves, 0) / nullif(games, 0);
  pmg numeric := nullif(pen_min, 0) / nullif(games, 0);
  score numeric;
  price numeric;
begin
  if position in ('V', 'G') then
    score := coalesce(save_pct, 0) * 0.6 + coalesce(spg, 0) * 0.3 - coalesce(pmg, 0) * 0.1;
    price := 7 + score * 6;
    if (coalesce(save_pct, 0) = 0 and coalesce(saves, 0) = 0 and coalesce(points, 0) = 0) then
      price := 7;
    end if;
  elsif position in ('A', 'F') then
    score := coalesce(ppg, 0) * 0.7 - coalesce(pmg, 0) * 0.3;
    price := 8 + score * 7;
    if coalesce(points, 0) = 0 then
      price := 8;
    end if;
  else
    score := coalesce(ppg, 0) * 0.8 - coalesce(pmg, 0) * 0.2;
    price := 9 + score * 6;
    if coalesce(points, 0) = 0 then
      price := 9;
    end if;
  end if;

  if price < 0 then
    price := 0;
  end if;

  return round(price::numeric, 1);
end;
$$ language plpgsql;

create or replace procedure public.recompute_prices()
language plpgsql
as $$
begin
  update public.players p
  set price_computed = public.compute_player_price(
    p.position,
    p.points,
    p.games,
    p.save_pct,
    p.saves,
    p.pen_min
  );

  update public.players
  set price_final = coalesce(price_manual, price_computed);
end;
$$;

create or replace view public.public_players as
select
  id,
  name,
  position,
  team,
  price_final,
  price_manual,
  price_computed,
  fppg
from public.players;

grant select on public.public_players to anon, authenticated;

commit;

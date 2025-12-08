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

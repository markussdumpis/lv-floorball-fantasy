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

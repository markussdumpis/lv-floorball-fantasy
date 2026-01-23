begin;

create or replace view public.public_players as
select
  id,
  name,
  position,
  team,
  price_final as price,
  price_final,
  price_computed,
  price_manual
from public.players;

grant select on public.public_players to anon, authenticated;

commit;

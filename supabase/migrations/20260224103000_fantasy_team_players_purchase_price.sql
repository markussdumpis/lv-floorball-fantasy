-- Lock player cost at purchase time so squad budget is stable when market prices change.

alter table public.fantasy_team_players
  add column if not exists purchase_price numeric not null default 0;

-- Backfill existing rows once using current players.price.
update public.fantasy_team_players ftp
set purchase_price = coalesce(p.price, 0)
from public.players p
where p.id = ftp.player_id
  and ftp.purchase_price = 0;

create index if not exists ftp_team_id_idx
  on public.fantasy_team_players (fantasy_team_id);

create or replace function public.set_fantasy_team_player_purchase_price()
returns trigger
language plpgsql
as $$
begin
  select coalesce(p.price, 0)
    into new.purchase_price
  from public.players p
  where p.id = new.player_id;

  new.purchase_price := coalesce(new.purchase_price, 0);
  return new;
end;
$$;

drop trigger if exists trg_ftp_set_purchase_price on public.fantasy_team_players;
create trigger trg_ftp_set_purchase_price
before insert or update of player_id
on public.fantasy_team_players
for each row
execute function public.set_fantasy_team_player_purchase_price();

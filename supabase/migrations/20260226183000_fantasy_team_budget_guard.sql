-- Enforce season squad budget on active roster rows.
create or replace function public.enforce_fantasy_team_active_budget()
returns trigger
language plpgsql
as $$
declare
  v_team_id uuid;
  v_total numeric;
begin
  v_team_id := coalesce(new.fantasy_team_id, old.fantasy_team_id);

  if v_team_id is null then
    return coalesce(new, old);
  end if;

  select coalesce(sum(ftp.purchase_price), 0)
    into v_total
  from public.fantasy_team_players ftp
  where ftp.fantasy_team_id = v_team_id
    and ftp.left_at is null;

  if round(v_total, 1) > 90 then
    raise exception 'BUDGET_EXCEEDED';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_enforce_fantasy_team_active_budget on public.fantasy_team_players;
create trigger trg_enforce_fantasy_team_active_budget
after insert or update of purchase_price, left_at, fantasy_team_id
on public.fantasy_team_players
for each row
execute function public.enforce_fantasy_team_active_budget();

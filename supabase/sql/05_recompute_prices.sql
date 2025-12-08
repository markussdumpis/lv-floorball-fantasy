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

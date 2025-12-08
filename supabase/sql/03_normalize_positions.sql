-- Harmonizes legacy player positions to the new U/A/V scheme.
-- Phase 1: map legacy codes and clear anything unknown.
update public.players
set position = case
  when position in ('U', 'A', 'V') then position
  when position = 'F' then 'U'
  when position = 'D' then 'A'
  when position = 'G' then 'V'
  else null
end
where position is distinct from case
    when position in ('U', 'A', 'V') then position
    when position = 'F' then 'U'
    when position = 'D' then 'A'
    when position = 'G' then 'V'
    else null
  end;

-- Phase 2: auto-assign goalies when save stats exist.
update public.players
set position = 'V'
where position is null
  and (coalesce(saves, 0) > 0 or coalesce(save_pct, 0) > 0);

-- Phase 3: default any remaining NULL positions to attacker (U).
update public.players
set position = 'U'
where position is null;

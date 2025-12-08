-- Rescales price_raw into position-specific bands and stores the result in price_final.
do $$
declare
  u_min constant numeric := 4.0;
  u_max constant numeric := 15.0;
  a_min constant numeric := 3.5;
  a_max constant numeric := 13.0;
  v_min constant numeric := 5.0;
  v_max constant numeric := 18.0;
begin
  with constants as (
    select 'U'::text as position, u_min as target_min, u_max as target_max
    union all
    select 'A', a_min, a_max
    union all
    select 'V', v_min, v_max
  ),
  raw_stats as (
    select
      position,
      min(price_raw) as raw_min,
      max(price_raw) as raw_max
    from public.players
    where position in ('U', 'A', 'V')
    group by position
  ),
  new_prices as (
    select
      p.id,
      p.position,
      c.target_min,
      c.target_max,
      case
        when r.raw_min is null or r.raw_max is null or r.raw_max = r.raw_min then c.target_min
        else c.target_min
          + (c.target_max - c.target_min)
          * (p.price_raw - r.raw_min)
          / nullif(r.raw_max - r.raw_min, 0)
      end as scaled_value
    from public.players p
    join constants c on c.position = p.position
    left join raw_stats r on r.position = p.position
    where p.position in ('U', 'A', 'V')
  )
  update public.players p
  set price_final = round(
    greatest(
      np.target_min,
      least(np.target_max, coalesce(np.scaled_value, np.target_min))
    ),
    1
  )
  from new_prices np
  where p.id = np.id;
end;
$$;

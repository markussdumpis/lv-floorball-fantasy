begin;

alter table public.profiles
  add column if not exists nickname_updated_at timestamptz;

update public.profiles
set nickname_updated_at = coalesce(created_at, now())
where nickname_updated_at is null
  and coalesce(trim(nickname), '') <> '';

create or replace function public.update_nickname(new_nickname text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_new_nickname text := trim(new_nickname);
  v_last_changed timestamptz;
  v_days_remaining int;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if v_new_nickname is null or length(v_new_nickname) < 3 or length(v_new_nickname) > 20 then
    raise exception 'NICKNAME_INVALID_LENGTH';
  end if;

  if v_new_nickname !~ '^[A-Za-z0-9_]+$' then
    raise exception 'NICKNAME_INVALID_CHARS';
  end if;

  select p.nickname_updated_at
  into v_last_changed
  from public.profiles p
  where p.id = v_user_id
  for update;

  if not found then
    insert into public.profiles (id, nickname, nickname_updated_at)
    values (v_user_id, v_new_nickname, now())
    on conflict (id) do update
      set nickname = excluded.nickname,
          nickname_updated_at = excluded.nickname_updated_at;
    return;
  end if;

  if v_last_changed is not null and (now() - v_last_changed) < interval '30 days' then
    v_days_remaining := ceil(extract(epoch from ((v_last_changed + interval '30 days') - now())) / 86400.0)::int;
    raise exception 'NICKNAME_COOLDOWN:%', greatest(v_days_remaining, 1);
  end if;

  update public.profiles
  set
    nickname = v_new_nickname,
    nickname_updated_at = now()
  where id = v_user_id;
end;
$$;

revoke all on function public.update_nickname(text) from public;
grant execute on function public.update_nickname(text) to authenticated;
grant execute on function public.update_nickname(text) to service_role;

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and nickname is not distinct from (
      select p.nickname
      from public.profiles p
      where p.id = auth.uid()
    )
    and nickname_updated_at is not distinct from (
      select p.nickname_updated_at
      from public.profiles p
      where p.id = auth.uid()
    )
  );

commit;

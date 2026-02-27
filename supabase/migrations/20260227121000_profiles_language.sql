begin;

alter table public.profiles
add column if not exists language text;

commit;

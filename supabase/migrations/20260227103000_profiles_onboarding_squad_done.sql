begin;

alter table public.profiles
add column if not exists onboarding_squad_done boolean not null default false;

commit;

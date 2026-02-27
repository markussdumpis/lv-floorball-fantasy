begin;

alter table public.profiles
add column if not exists onboarding_main_completed boolean not null default false,
add column if not exists onboarding_squad_completed boolean not null default false;

commit;

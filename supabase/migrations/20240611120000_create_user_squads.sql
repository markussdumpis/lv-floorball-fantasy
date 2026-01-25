-- Create user_squads table
create table if not exists public.user_squads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  season text not null default '2025/2026',
  transfers_left int not null default 3,
  budget_total numeric not null default 100,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, season)
);

-- Create user_squad_slots table
create table if not exists public.user_squad_slots (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references public.user_squads(id) on delete cascade,
  slot_key text not null,
  player_id uuid references public.players(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (squad_id, slot_key)
);

-- Enable RLS
alter table public.user_squads enable row level security;
alter table public.user_squad_slots enable row level security;

-- Policies for user_squads
create policy "Select own squad" on public.user_squads
  for select using (auth.uid() = user_id);
create policy "Insert own squad" on public.user_squads
  for insert with check (auth.uid() = user_id);
create policy "Update own squad" on public.user_squads
  for update using (auth.uid() = user_id);
create policy "Delete own squad" on public.user_squads
  for delete using (auth.uid() = user_id);

-- Policies for user_squad_slots (join via squad)
create policy "Select own squad slots" on public.user_squad_slots
  for select using (
    exists (
      select 1 from public.user_squads s
      where s.id = squad_id and s.user_id = auth.uid()
    )
  );
create policy "Insert own squad slots" on public.user_squad_slots
  for insert with check (
    exists (
      select 1 from public.user_squads s
      where s.id = squad_id and s.user_id = auth.uid()
    )
  );
create policy "Update own squad slots" on public.user_squad_slots
  for update using (
    exists (
      select 1 from public.user_squads s
      where s.id = squad_id and s.user_id = auth.uid()
    )
  );
create policy "Delete own squad slots" on public.user_squad_slots
  for delete using (
    exists (
      select 1 from public.user_squads s
      where s.id = squad_id and s.user_id = auth.uid()
    )
  );

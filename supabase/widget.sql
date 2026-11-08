-- Rumo · chave do widget da tela de início (Scriptable). Só serve pra ler as coisas de hoje.
create table if not exists public.rumo_widget (
  token text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  criado timestamptz not null default now()
);
alter table public.rumo_widget enable row level security;
drop policy if exists "widget da dona" on public.rumo_widget;
create policy "widget da dona" on public.rumo_widget for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

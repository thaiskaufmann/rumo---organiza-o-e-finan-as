-- Rumo · entrar com QR code (códigos temporários; só o servidor lê)
create table if not exists public.rumo_pareamento (
  codigo text primary key,
  token_hash text not null,
  email text,
  criado timestamptz not null default now()
);
alter table public.rumo_pareamento enable row level security;

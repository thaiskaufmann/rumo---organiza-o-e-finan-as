-- Rumo · notificações. Cole tudo no SQL Editor do Supabase e toque em Run.
create table if not exists public.rumo_push_subs (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  sub jsonb not null,
  criado timestamptz not null default now()
);
alter table public.rumo_push_subs enable row level security;
drop policy if exists "aparelhos da dona" on public.rumo_push_subs;
create policy "aparelhos da dona" on public.rumo_push_subs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.rumo_lembretes (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  chave text not null,
  quando timestamptz not null,
  titulo text not null,
  corpo text,
  enviado boolean not null default false,
  unique (user_id, chave)
);
create index if not exists rumo_lembretes_fila on public.rumo_lembretes (enviado, quando);
alter table public.rumo_lembretes enable row level security;
drop policy if exists "lembretes da dona" on public.rumo_lembretes;
create policy "lembretes da dona" on public.rumo_lembretes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- chaves do carteiro: sem regra de acesso = só o servidor lê
create table if not exists public.rumo_push_cfg (id int primary key, publica text, privada text);
alter table public.rumo_push_cfg enable row level security;

-- chama o carteiro a cada minuto (TROQUE o endereço abaixo pela URL do seu projeto)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('rumo-push', '* * * * *',
  $$ select net.http_post(url := 'https://SEU-PROJETO.supabase.co/functions/v1/rumo-push', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb) $$);

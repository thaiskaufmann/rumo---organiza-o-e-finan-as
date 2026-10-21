-- Nina no Telegram: ligação da conta, controle de envio e agendamento
create table if not exists public.rumo_telegram (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  chat_id bigint unique,
  codigo text unique,
  nome_tg text,
  pendente jsonb,
  ultimo jsonb,
  criado timestamptz not null default now()
);
alter table public.rumo_telegram enable row level security;
drop policy if exists "telegram da dona" on public.rumo_telegram;
create policy "telegram da dona" on public.rumo_telegram for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.rumo_lembretes add column if not exists enviado_tg boolean not null default false;
update public.rumo_lembretes set enviado_tg = true where quando < now();

select cron.schedule('rumo-nina', '* * * * *',
  $$ select net.http_post(url := 'https://ekrpaspjjbdjmoxsblzq.supabase.co/functions/v1/nina?acao=cron', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb) $$);

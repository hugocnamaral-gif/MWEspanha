-- ==========================================================================
-- MYMW · Esquema Supabase para o portal do cliente da Mobilwave
-- Correr uma vez no SQL Editor do Supabase (novo separador).
-- Nota: os dados do ERP continuam no blob único `app_state`. O portal NUNCA
-- lê esse blob diretamente — só através das Edge Functions (que filtram por
-- cliente no servidor). Estas tabelas são apenas o mapa email->cliente e a
-- fila de pedidos submetidos pelo portal.
-- ==========================================================================

-- 1) Ligação: email do utilizador do portal -> id do cliente no ERP ---------
create table if not exists public.client_users (
  email      text primary key,
  client_id  text not null,           -- o id do cliente tal como está no ERP (ex.: "c7")
  nome       text,                     -- opcional, para referência
  created_at timestamptz default now()
);

alter table public.client_users enable row level security;

-- cada utilizador autenticado só consegue ler a SUA própria linha
drop policy if exists "client_users self read" on public.client_users;
create policy "client_users self read" on public.client_users
  for select using (auth.jwt() ->> 'email' = email);

-- (as inserções nesta tabela são feitas pela equipa, com a service key / painel)


-- 2) Fila de pedidos de suporte submetidos pelo portal ("por aprovar") ------
create table if not exists public.portal_requests (
  id         uuid primary key default gen_random_uuid(),
  client_id  text not null,
  user_email text not null,
  assunto    text not null,
  descricao  text,
  prioridade text default 'media',
  estado     text not null default 'por_aprovar',  -- por_aprovar | aprovado | recusado
  created_at timestamptz default now()
);

alter table public.portal_requests enable row level security;

-- o cliente só pode inserir pedidos para o SEU cliente
drop policy if exists "portal_requests insert own" on public.portal_requests;
create policy "portal_requests insert own" on public.portal_requests
  for insert with check (
    client_id = (select client_id from public.client_users
                 where email = auth.jwt() ->> 'email')
  );

-- o cliente só lê os pedidos do SEU cliente
drop policy if exists "portal_requests read own" on public.portal_requests;
create policy "portal_requests read own" on public.portal_requests
  for select using (
    client_id = (select client_id from public.client_users
                 where email = auth.jwt() ->> 'email')
  );

-- 3) A EQUIPA (utilizadores internos com linha em `profiles`) gere a fila -----
-- Isto permite que o ERP, com a chave anon e a sessão do colaborador, leia e
-- atualize TODOS os pedidos (aprovar/recusar). Os clientes do portal não têm
-- linha em `profiles`, por isso continuam limitados aos seus próprios pedidos.
drop policy if exists "portal_requests staff manage" on public.portal_requests;
create policy "portal_requests staff manage" on public.portal_requests
  for all
  using      (exists (select 1 from public.profiles p where p.id = auth.uid()))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()));

-- Exemplo de associação de um utilizador a um cliente:
-- insert into public.client_users (email, client_id, nome)
-- values ('dr.elvira@hrambla.es', 'c7', 'H. Rambla Nova');

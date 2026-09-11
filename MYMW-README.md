# MYMW — Portal do Cliente Mobilwave

Portal onde cada cliente entra (por link mágico, sem passwords) e vê **apenas os seus dados**: faturas com estado (paga / pendente / vencida), pedidos de suporte, e o estado dos seus projetos. Pode também **abrir um novo pedido de suporte**, que envia email para `soporte@mobilwave.es` e entra numa fila **«por aprovar»** antes de virar ticket.

## Porque é seguro (arquitetura)

Os dados do ERP vivem num **único blob JSONB** (`app_state`). O portal **nunca lê esse blob diretamente** — se lesse, veria os dados de todos os clientes. Em vez disso:

- O portal só tem a **chave publishable/anon** (pública, sem problema).
- Toda a leitura passa por uma **Edge Function** (`mymw-data`) que corre no servidor com a *service key*, descobre a que cliente o email pertence e devolve **só a fatia desse cliente**.
- Os segredos (service key, chave de email) ficam **no Supabase**, nunca no frontend.

## Ficheiros

| Ficheiro | O que é |
|---|---|
| `mymw.html` | O portal (uma página, publica no Vercel/Netlify). |
| `mymw_supabase.sql` | Tabelas `client_users` (email→cliente) e `portal_requests` (fila) + políticas RLS. |
| `mymw_functions/mymw-data/index.ts` | Edge Function que devolve faturas/tickets/projetos do cliente. |
| `mymw_functions/mymw-request/index.ts` | Edge Function que regista o pedido + envia email a soporte. |

## Passos de configuração

1. **SQL** — no Supabase › SQL Editor, cola e corre `mymw_supabase.sql`.

2. **Associar utilizadores a clientes** — para cada pessoa do lado do cliente:
   ```sql
   insert into public.client_users (email, client_id, nome)
   values ('dr.elvira@hrambla.es', 'c7', 'H. Rambla Nova');
   ```
   (o `client_id` é o id do cliente tal como está no ERP).

3. **Edge Functions** — com o Supabase CLI, a partir da raiz do projeto:
   ```bash
   supabase functions deploy mymw-data
   supabase functions deploy mymw-request
   ```
   (Coloca as pastas em `supabase/functions/`.)

4. **Segredos das funções** — no Supabase › Edge Functions › Secrets (ou `supabase secrets set`):
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (as duas primeiras já costumam existir; a service key é obrigatória).
   - `RESEND_API_KEY` — chave da Resend (ou outro serviço) para enviar o email. Sem ela, o pedido fica na fila na mesma, só não envia email.
   - `APP_STATE_ID` — **opcional**. Só se tiveres mais do que uma linha na tabela `app_state`; indica o `id` da linha do estado. Se só tiveres uma, deixa vazio.

5. **Auth** — no Supabase › Authentication:
   - Ativa o **Email** (magic link).
   - Em *URL Configuration*, acrescenta o domínio do portal (ex.: `https://my.mobilwave.es`) aos *Redirect URLs*.

6. **Portal** — abre `mymw.html` e preenche o bloco `MYMW_CONFIG` no topo com o `SUPABASE_URL` e a `SUPABASE_ANON_KEY`. Publica o ficheiro (Vercel/Netlify) no subdomínio, ex. `my.mobilwave.es`.

> Antes de configurares, o portal abre em **modo de pré-visualização** com dados de exemplo, para veres o aspeto.

## O circuito do pedido de suporte

1. Cliente escreve o pedido no portal.
2. `mymw-request` grava-o em `portal_requests` com estado **`por_aprovar`** e envia email a `soporte@mobilwave.es`.
3. A vossa equipa valida no ERP e, ao aprovar, cria o ticket real (e marca o pedido como `aprovado`).
4. O ticket e o estado passam a aparecer ao cliente no portal.

## Passo que falta no ERP (a fazer a seguir)

Para fechar o circuito, o ERP precisa de uma pequena adição: **ler `portal_requests` (estado `por_aprovar`)** e mostrar essa fila em **Suporte**, com um botão **Aprovar** que cria o ticket e marca o pedido como `aprovado`. Como o ERP hoje só lê o seu blob, isto implica acrescentar uma consulta à tabela `portal_requests` (com a mesma ligação Supabase já existente). Posso acrescentar isto ao `index.html` quando quiseres.

// Supabase Edge Function: inbound-email
// Recebe emails de entrada (webhook do Resend Inbound, ou de outro fornecedor
// de email->webhook) e transforma-os em pedidos de suporte: associa a mensagem
// a um ticket existente (pelo código [tkXXXXXX] no assunto ou pelo email do
// remetente com um pedido em aberto) ou cria um novo pedido.
//
// PUBLICAR:
//   supabase functions new inbound-email
//   # cola este ficheiro em supabase/functions/inbound-email/index.ts
//   supabase functions deploy inbound-email --no-verify-jwt   (o webhook não traz JWT)
//   supabase secrets set INBOUND_TOKEN=um-segredo-forte
//   No fornecedor de email, aponta o webhook de receção para:
//   https://<project>.functions.supabase.co/inbound-email?token=um-segredo-forte
//
// Segurança: valida o ?token= para impedir chamadas não autorizadas.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
}
function uid() { return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const url = new URL(req.url);
  const expected = Deno.env.get("INBOUND_TOKEN");
  if (expected && url.searchParams.get("token") !== expected) return json({ error: "Não autorizado" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ROW_ID = Deno.env.get("APP_STATE_ID") || "1"; // id da linha em app_state (tenant)

  // Aceita vários formatos de payload (Resend / genérico)
  let p: Record<string, any>;
  try { p = await req.json(); } catch { return json({ error: "Corpo inválido" }, 400); }
  const from = (p.from?.email || p.from || p.sender || "").toString().toLowerCase();
  const fromName = (p.from?.name || p.fromName || "").toString();
  const subject = (p.subject || "(sem assunto)").toString();
  const text = (p.text || p.body || p.stripped_text || "").toString();
  if (!from) return json({ error: "Sem remetente" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: row, error } = await admin.from("app_state").select("data").eq("id", ROW_ID).single();
  if (error || !row) return json({ error: "Estado não encontrado" }, 500);
  const D = row.data || {};
  if (!Array.isArray(D.tickets)) D.tickets = [];

  const today = new Date().toISOString().slice(0, 10);
  const msg = { id: uid(), direcao: "recebida", canal: "email", de: from, data: today, corpo: text };

  // 1) por código [tkXXXXXX] no assunto
  const m = subject.match(/\[(tk[0-9a-z]{4,})\]/i);
  let t = m ? D.tickets.find((x: any) => (x.id || "").toLowerCase().startsWith(m[1].toLowerCase())) : null;
  // 2) por email do remetente com ticket em aberto
  if (!t) t = D.tickets.find((x: any) => (x.fromEmail || "").toLowerCase() === from && x.estado !== "resolvido" && x.estado !== "fechado");

  if (t) {
    if (!Array.isArray(t.mensagens)) t.mensagens = [];
    t.mensagens.push(msg);
    if (t.estado === "a_aguardar" || t.estado === "resolvido") t.estado = "aberto";
  } else {
    D.tickets.push({
      id: uid(), titulo: subject.replace(/\[tk[0-9a-z]+\]/i, "").trim() || "Pedido por email",
      estado: "aberto", canal: "email", prioridade: "media",
      fromEmail: from, fromNome: fromName, clientId: "", createdAt: today,
      mensagens: [msg], intervencoes: [],
    });
  }

  const { error: upErr } = await admin.from("app_state").update({ data: D }).eq("id", ROW_ID);
  if (upErr) return json({ error: upErr.message }, 500);
  return json({ ok: true, ticket: t ? "updated" : "created" });
});

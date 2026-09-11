// supabase/functions/mymw-data/index.ts
// Devolve APENAS os dados do cliente autenticado (faturas, tickets, projetos),
// extraídos no servidor a partir do blob `app_state` com a service key.
// Deploy:  supabase functions deploy mymw-data
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");

    // 1) verificar quem é o utilizador
    const userClient = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "não autenticado" }, 401);

    const admin = createClient(URL, SERVICE);

    // 2) que cliente é este email?
    const { data: map } = await admin.from("client_users").select("client_id").eq("email", user.email).maybeSingle();
    if (!map) return json({ error: "utilizador sem cliente associado" }, 403);
    const clientId = map.client_id as string;

    // 3) ler o estado do ERP (blob único). APP_STATE_ID é opcional.
    const stateId = Deno.env.get("APP_STATE_ID");
    let q = admin.from("app_state").select("data");
    if (stateId) q = q.eq("id", stateId);
    const { data: rows } = await q.limit(1);
    const D: any = (rows && rows[0] && (rows[0] as any).data) || {};

    const deals = D.deals || [], clients = D.clients || [], invoices = D.invoices || [],
      tickets = D.tickets || [], projectos = D.projectos || [];
    const cliente = clients.find((c: any) => c.id === clientId) || {};
    const dealClient = (id: string) => (deals.find((d: any) => d.id === id) || {}).clientId;
    const today = new Date().toISOString().slice(0, 10);

    const faturas = invoices
      .filter((inv: any) => dealClient(inv.dealId) === clientId)
      .map((inv: any) => {
        const dl = deals.find((d: any) => d.id === inv.dealId) || {};
        const paga = !!inv.collected;
        const vencida = !paga && inv.date && inv.date < today;
        return { descricao: dl.product ? "Fatura · " + dl.product : "Fatura", data: inv.date, valor: inv.amount,
                 estado: paga ? "paga" : vencida ? "vencida" : "pendente" };
      })
      .sort((a: any, b: any) => (b.data || "").localeCompare(a.data || ""));

    const tks = tickets
      .filter((t: any) => t.clientId === clientId)
      .map((t: any) => ({ titulo: t.titulo || t.assunto, ref: String(t.id || "").slice(0, 4),
                          data: t.createdAt, estado: t.estado, descricao: t.descricao }));

    // juntar os pedidos do portal ainda por aprovar
    const { data: pend } = await admin.from("portal_requests")
      .select("*").eq("client_id", clientId).eq("estado", "por_aprovar");
    (pend || []).forEach((p: any) =>
      tks.unshift({ titulo: p.assunto, ref: "", data: p.created_at, estado: "por_aprovar", descricao: p.descricao }));

    const projs = projectos
      .filter((p: any) => dealClient(p.dealId) === clientId)
      .map((p: any) => {
        const dl = deals.find((d: any) => d.id === p.dealId) || {};
        const fase = (p.fases || []).find((f: any) => f.estado === "em_curso");
        const concluido = dl.stage === "concluido" ||
          ((p.fases || []).length > 0 && (p.fases || []).every((f: any) => f.estado === "concluida"));
        return { nome: p.nome || dl.product || "Projeto", fase: fase ? fase.l || fase.k : "—", concluido };
      });

    return json({ cliente: { nome: cliente.name || cliente.nome || "" }, faturas, tickets: tks, projetos: projs });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

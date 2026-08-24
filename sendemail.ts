// Supabase Edge Function: send-email
// Envia emails via Resend. Usada pela Cobrança de vencidos e pelo Suporte
// (resposta ao cliente a partir do ticket).
//
// PUBLICAR:
//   supabase functions new send-email
//   # cola este ficheiro em supabase/functions/send-email/index.ts
//   supabase secrets set RESEND_API_KEY=re_xxx
//   supabase secrets set MAIL_FROM="Suporte <suporte@oteudominio.pt>"
//   supabase functions deploy send-email
//
// Requer um domínio verificado no Resend (https://resend.com).

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const KEY = Deno.env.get("RESEND_API_KEY");
  const FROM = Deno.env.get("MAIL_FROM") || "no-reply@example.com";
  if (!KEY) return json({ error: "RESEND_API_KEY não configurada." }, 500);

  let body: { to?: string; subject?: string; text?: string; html?: string };
  try { body = await req.json(); } catch { return json({ error: "Corpo inválido." }, 400); }
  const to = (body.to || "").trim();
  if (!to || !to.includes("@")) return json({ error: "Destinatário inválido." }, 400);

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: body.subject || "(sem assunto)",
      text: body.text || "",
      html: body.html || (body.text ? `<pre style="font-family:inherit;white-space:pre-wrap">${body.text}</pre>` : undefined),
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: data?.message || "Falha no envio." }, 400);
  return json({ ok: true, id: data?.id });
});

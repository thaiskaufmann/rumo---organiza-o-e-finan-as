// Rumo · carteiro das notificações (Supabase Edge Function "rumo-push")
// Roda a cada minuto (pelo agendamento do banco) e manda os lembretes que chegaram na hora.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, "Content-Type": "application/json" } });

async function chaves() {
  const { data } = await sb.from("rumo_push_cfg").select("publica,privada").eq("id", 1).maybeSingle();
  if (data) return data;
  const k = webpush.generateVAPIDKeys();
  await sb.from("rumo_push_cfg").upsert({ id: 1, publica: k.publicKey, privada: k.privateKey });
  return { publica: k.publicKey, privada: k.privateKey };
}

async function enviar(sub: { endpoint: string; sub: webpush.PushSubscription }, msg: Record<string, string>) {
  try { await webpush.sendNotification(sub.sub, JSON.stringify(msg), { TTL: 3600 }); return true; }
  catch (e) {
    const s = (e as { statusCode?: number }).statusCode;
    if (s === 404 || s === 410) await sb.from("rumo_push_subs").delete().eq("endpoint", sub.endpoint);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const acao = url.searchParams.get("acao");
  const k = await chaves();
  if (acao === "chave") return json({ publica: k.publica });
  webpush.setVapidDetails("https://thaiskaufmann.github.io", k.publica, k.privada);

  if (acao === "teste") {
    const endpoint = url.searchParams.get("endpoint") || "";
    const { data: subs } = await sb.from("rumo_push_subs").select("endpoint,sub").eq("endpoint", endpoint);
    let n = 0;
    for (const s of subs || []) if (await enviar(s, { titulo: "Notificações ligadas", corpo: "É assim que o Rumo vai te avisar.", tag: "teste" })) n++;
    return json({ enviados: n });
  }

  // lembretes que venceram nos últimos 30 minutos e ainda não foram mandados
  const agora = new Date();
  const desde = new Date(agora.getTime() - 30 * 60000).toISOString();
  await sb.from("rumo_lembretes").update({ enviado: true }).eq("enviado", false).lt("quando", desde);
  const { data: devidos } = await sb.from("rumo_lembretes").update({ enviado: true })
    .eq("enviado", false).lte("quando", agora.toISOString()).select("user_id,titulo,corpo,chave");
  let n = 0;
  const porUser = new Map<string, typeof devidos>();
  for (const l of devidos || []) { if (!porUser.has(l.user_id)) porUser.set(l.user_id, []); porUser.get(l.user_id)!.push(l); }
  for (const [uid, ls] of porUser) {
    const { data: subs } = await sb.from("rumo_push_subs").select("endpoint,sub").eq("user_id", uid);
    for (const l of ls!) for (const s of subs || []) if (await enviar(s, { titulo: l.titulo, corpo: l.corpo || "", tag: l.chave })) n++;
  }
  return json({ enviados: n });
});

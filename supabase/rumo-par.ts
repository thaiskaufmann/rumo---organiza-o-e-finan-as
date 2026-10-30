// Rumo · entrar no computador com QR code (Supabase Edge Function "rumo-par")
// O computador mostra um código; o celular (já logado) aprova; o computador entra sem senha.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

function chaveServidor(): string {
  const velha = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (velha) return velha;
  try { const s = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return (s.default || Object.values(s)[0] || "") as string; } catch { return ""; }
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, chaveServidor(), { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
const json = (o: unknown, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { ...cors, "Content-Type": "application/json" } });
const limpa = (c: string) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const acao = url.searchParams.get("acao");

  // celular logado aprova o código que apareceu no computador
  if (acao === "aprovar") {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error } = await sb.auth.getUser(jwt);
    if (error || !u?.user?.email) return json({ erro: "Entre no Rumo neste celular primeiro." }, 401);
    let body: { codigo?: string } = {};
    try { body = await req.json(); } catch { /* vazio */ }
    const codigo = limpa(body.codigo || "");
    if (codigo.length < 8) return json({ erro: "Código inválido." }, 400);
    const { data: link, error: e2 } = await sb.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
    if (e2 || !link?.properties?.hashed_token) return json({ erro: "Não consegui gerar o acesso agora." }, 500);
    await sb.from("rumo_pareamento").delete().lt("criado", new Date(Date.now() - 10 * 60000).toISOString());
    const { error: e3 } = await sb.from("rumo_pareamento").upsert({ codigo, token_hash: link.properties.hashed_token, email: u.user.email, criado: new Date().toISOString() });
    if (e3) return json({ erro: "Falta a tabela de pareamento no Supabase." }, 500);
    return json({ ok: true });
  }

  // computador pergunta se o código já foi aprovado (uso único, vale 5 minutos)
  if (acao === "ver") {
    const codigo = limpa(url.searchParams.get("codigo") || "");
    if (codigo.length < 8) return json({ ok: false });
    const { data } = await sb.from("rumo_pareamento").select("token_hash,email,criado").eq("codigo", codigo).maybeSingle();
    if (!data) return json({ ok: false });
    await sb.from("rumo_pareamento").delete().eq("codigo", codigo);
    if (Date.now() - Date.parse(data.criado) > 5 * 60000) return json({ ok: false, expirou: true });
    return json({ ok: true, token_hash: data.token_hash, email: data.email });
  }

  return json({ ok: true, servico: "rumo-par" });
});

// Nina · assistente do Rumo no Telegram (Supabase Edge Function "nina")
// Sem IA: entende frases em formatos fixos e grava direto nos dados do Rumo.
// Precisa do segredo TELEGRAM_TOKEN (Edge Functions › Secrets).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/* ====================== utilidades de data (horário de Brasília) ====================== */
const pad = (n) => String(n).padStart(2, "0");
const agoraSP = () => new Date(Date.now() - 3 * 3600e3); // campos UTC = hora local de Brasília
const ymd = (d) => d.toISOString().slice(0, 10);
const TODAY = () => ymd(agoraSP());
const parseD = (s) => new Date(String(s) + "T00:00:00Z");
const addDays = (s, n) => { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parseD(b).getTime() - parseD(a).getTime()) / 864e5);
const addMonth = (m, n) => { const [y, mm] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mm - 1 + n, 1)); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1); };
const monthsBetween = (a, b) => { const [y1, m1] = a.split("-").map(Number), [y2, m2] = b.split("-").map(Number); return (y2 - y1) * 12 + (m2 - m1); };
const daysInMonth = (m) => { const [y, mm] = m.split("-").map(Number); return new Date(Date.UTC(y, mm, 0)).getUTCDate(); };
const DOW = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const fmtD = (d) => { const x = parseD(d); return DOW[x.getUTCDay()] + ", " + pad(x.getUTCDate()) + "/" + pad(x.getUTCMonth() + 1); };
const novoId = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const cap = (s) => { s = String(s || "").trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };
const r2 = (v) => Math.round((+v || 0) * 100) / 100;
const brl = (v) => "R$ " + (+v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plural = (n, a, b) => (n === 1 ? a : b);
function parseNum(s) {
  s = String(s ?? "").replace(/R\$|\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) return +s.replace(/\./g, "").replace(",", ".");
  if (/^\d+,\d{1,2}$/.test(s)) return +s.replace(",", ".");
  return +s;
}

/* ====================== categorias (iguais ao app) ====================== */
const KW = {
  "Alimentação": ["mercado", "supermerc", "ifood", "padaria", "restaurante", "lanchonete", "lanche", "acougue", "hortifruti", "assai", "atacadao", "carrefour", "guanabara", "prezunic", "zona sul", "pao de acucar", "rappi", "burger", "mcdonald", "pizza", "cafeteria", "bobs", "subway", "sacolao", "feira", "cafe", "acai", "sorvete", "delivery"],
  "Moradia": ["aluguel", "imobiliaria", "condominio", "iptu"],
  "Contas da casa": ["light", "luz", "enel", "cedae", "agua", "aguas do rio", "naturgy", "gas", "internet", "claro", "vivo", "tim", "oi fibra", "sky", "celular"],
  "Transporte": ["uber", "99", "posto", "combustivel", "gasolina", "shell", "ipiranga", "metro", "metrorio", "riocard", "onibus", "estacionamento", "sem parar", "supervia", "taxi"],
  "Saúde": ["farmacia", "drogasil", "droga raia", "raia", "pacheco", "venancio", "drogaria", "remedio", "consulta", "clinica", "laboratorio", "exame", "unimed", "amil", "sulamerica", "academia", "smartfit", "smart fit", "dentista", "medico", "psicologa", "terapia"],
  "Beleza": ["salao", "manicure", "unha", "cabelo", "sephora", "boticario", "natura", "beleza", "estetica", "sobrancelha", "maquiagem", "depilacao"],
  "Lazer": ["cinema", "cinemark", "ingresso", "sympla", "bar", "show", "teatro", "viagem", "hotel", "airbnb", "booking", "praia"],
  "Assinaturas": ["netflix", "spotify", "prime video", "amazon prime", "disney", "hbo", "max", "youtube", "icloud", "google one", "canva", "chatgpt", "claude", "capcut", "deezer", "globoplay", "paramount", "assinatura"],
  "Compras": ["shopee", "mercadolivre", "mercado livre", "amazon", "shein", "magalu", "renner", "riachuelo", "americanas", "aliexpress", "temu", "roupa", "sapato", "tenis"],
  "Educação": ["curso", "escola", "faculdade", "livraria", "livro", "hotmart", "udemy", "kiwify", "eduzz"],
  "Trabalho": ["meta ads", "google ads", "adobe", "registro br", "hostinger", "netlify", "lovable", "anuncio"],
};
const KWLIST = Object.entries(KW).flatMap(([c, ks]) => ks.map((k) => [k, c])).sort((a, b) => b[0].length - a[0].length);
const GUARD = "Guardado";
function categorizar(desc, cfg) {
  const hay = " " + norm(desc) + " ";
  const regras = cfg.regras || {};
  for (const k of Object.keys(regras).sort((a, b) => b.length - a.length)) if (hay.includes(" " + k)) return regras[k];
  const nomes = (cfg.cats || []).map((c) => c.n);
  for (const [k, c] of KWLIST) if (hay.includes(" " + k + " ") || hay.includes(" " + k)) return nomes.includes(c) || !nomes.length ? c : "Outros";
  return "Outros";
}
const catEntrada = (d) => { const n = norm(d); return /(afiliad|shopee|comiss|amazon|mercado livre)/.test(n) ? "Afiliados" : /(cliente|ugc|job|freela|servico|consultoria|post|campanha)/.test(n) ? "Clientes" : "Outras entradas"; };

/* ====================== banco ====================== */
function chaveServidor() {
  const velha = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (velha) return velha;
  try { const s = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return s.default || Object.values(s)[0] || ""; } catch { return ""; }
}
const sb = createClient(Deno.env.get("SUPABASE_URL"), chaveServidor(), { auth: { persistSession: false } });
const TOKEN = Deno.env.get("TELEGRAM_TOKEN") || "";

const FIN0 = { config: { renda: 0, guardar: 0, limite: 90, cats: [], regras: {} }, recorrentes: [], compras: [], metas: [], dividas: [] };
const DEFS = {
  perfil: { nome: "Thais" },
  tarefas: { items: [] },
  fin: FIN0,
  saude: { ciclo: { registros: [] }, injecao: { intervalo: 30, ultima: "", historico: [], nome: "", hora: "" }, sono: [] },
};
// carrega os documentos da pessoa; muda só o que precisar e grava de volta com hora nova
async function carregar(uid, chaves) {
  const { data } = await sb.from("rumo_docs").select("key,data").eq("user_id", uid).in("key", chaves);
  const docs = {};
  for (const k of chaves) {
    const r = (data || []).find((x) => x.key === k);
    const base = k.startsWith("m:") ? { tx: [] } : structuredClone(DEFS[k] || {});
    docs[k] = r && r.data ? { ...base, ...r.data } : base;
    if (k === "fin") docs[k].config = { ...FIN0.config, ...(docs[k].config || {}) };
    if (k === "saude") docs[k].injecao = { ...DEFS.saude.injecao, ...(docs[k].injecao || {}) };
  }
  return docs;
}
async function gravar(uid, key, data) {
  await sb.from("rumo_docs").upsert({ user_id: uid, key, data, updated_at: new Date().toISOString() });
}

/* ====================== telegram ====================== */
async function tg(metodo, corpo) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  return r.json();
}
const kb = (linhas) => ({ inline_keyboard: linhas.map((l) => l.map(([text, callback_data]) => ({ text, callback_data: String(callback_data).slice(0, 64) }))) });
async function falar(chat, texto, botoes) {
  return tg("sendMessage", { chat_id: chat, text: texto, parse_mode: "HTML", disable_web_page_preview: true, ...(botoes ? { reply_markup: kb(botoes) } : {}) });
}
async function segredo() {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("rumo-nina:" + TOKEN));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

/* ====================== regras do Rumo (iguais ao app) ====================== */
const repDe = (i) => (i.tipo === "habito" ? (i.rep && i.rep !== "nao" ? i.rep : "dias") : i.rep || "nao");
const isRep = (i) => repDe(i) !== "nao";
function ocorre(i, d) {
  const r = repDe(i);
  if (r === "nao") return i.data === d;
  const ini = i.data || i.inicio || "0000-01-01"; if (d < ini) return false;
  const wd = parseD(d).getUTCDay();
  if (r === "diario") return true;
  if (r === "dias") return !i.dias || !i.dias.length || i.dias.map(Number).includes(wd);
  if (r === "semanal") return wd === parseD(ini).getUTCDay();
  if (r === "mensal") return parseD(d).getUTCDate() === parseD(ini).getUTCDate();
  return false;
}
const isDone = (i, d) => (isRep(i) ? i.feitos?.[d] === true : !!i.feito);
const isSkip = (i, d) => isRep(i) && i.feitos?.[d] === "pulou";
function injStatus(sa) { const j = sa.injecao; if (!j.ultima) return null; const prox = addDays(j.ultima, +j.intervalo || 30); return { prox, falta: diffDays(TODAY(), prox) }; }
function recAtivo(r, m) { if (r.tipo !== "parcela" || !r.total) return true; const k = monthsBetween(r.inicioMes || m, m); return k >= 0 && k < (+r.total - (+r.pagasAntes || 0)); }
function fin(F, tx, m) {
  let ent = 0, sai = 0, guard = 0; const porCat = {};
  for (const t of tx) { const v = +t.valor || 0; if (t.tipo === "entrada") ent += v; else if (t.cat === GUARD) guard += v; else { sai += v; porCat[t.cat] = (porCat[t.cat] || 0) + v; } }
  const pend = F.recorrentes.filter((r) => recAtivo(r, m) && !(r.pagos || {})[m]).reduce((a, r) => a + (+r.valor || 0), 0);
  const renda = +F.config.renda || 0, base = Math.max(renda, ent);
  const reservaG = Math.max(+F.config.guardar || 0, guard);
  return { livre: base - sai - pend - reservaG, sai, ent, pend, base, porCat };
}
const vence = (r, m) => m + "-" + pad(Math.min(+r.dia || 1, daysInMonth(m)));

/* ====================== entendendo as mensagens ====================== */
const NW = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900, mil: 1000 };
function valorPorExtenso(n) {
  const ws = n.split(" "); let total = 0, cur = 0, ok = false;
  for (let i = 0; i < ws.length; i++) { const w = ws[i]; if (w in NW) { ok = true; if (w === "mil") { total += (cur || 1) * 1000; cur = 0; } else cur += NW[w]; } else if (w === "e" && ok) continue; else if (ok) break; }
  return ok ? total + cur : null;
}
const NUM = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i;
function parseLanc(txt) {
  let s = " " + txt.trim() + " ", tipo = "saida", data = TODAY(); const n = norm(txt);
  if (/^(recebi|ganhei|entrou|entrada|caiu|vendi)\b/.test(n)) tipo = "entrada";
  if (/\bontem\b/.test(n)) data = addDays(TODAY(), -1);
  if (/\banteontem\b/.test(n)) data = addDays(TODAY(), -2);
  let valor = null; const m = s.match(NUM);
  if (m) { valor = parseNum(m[1]); s = s.replace(m[0], " "); } else valor = valorPorExtenso(n);
  const desc = s.replace(/\b(reais|real|r\$|centavos|gastei|paguei|comprei|recebi|ganhei|entrou|entrada|caiu|vendi|ontem|anteontem|hoje|no|na|nos|nas|com|de|do|da|em|e|um|uma|pra|para|uns|umas)\b/gi, " ").replace(/[,.;:]/g, " ").replace(/\s+/g, " ").trim();
  return { valor, desc: cap(desc) || (tipo === "entrada" ? "Entrada" : "Gasto"), tipo, data };
}
function parseItem(txt) {
  const n = norm(txt), t = TODAY(); let data = "", hora = "";
  const hm = txt.match(/(?:^|\s)(?:às|as|a partir das)?\s*(\d{1,2})(?:[:h](\d{2})?)\s*(?:h|hs|horas)?(?=\s|$)/i) || txt.match(/(?:^|\s)(\d{1,2})\s*(?:h|hs|horas)(?=\s|$)/i);
  if (hm && +hm[1] < 24) hora = pad(+hm[1]) + ":" + pad(+(hm[2] || 0));
  if (/\bhoje\b/.test(n)) data = t; else if (/\bdepois de amanha\b/.test(n)) data = addDays(t, 2); else if (/\bamanha\b/.test(n)) data = addDays(t, 1);
  const dias = [["domingo", 0], ["segunda", 1], ["terca", 2], ["quarta", 3], ["quinta", 4], ["sexta", 5], ["sabado", 6]];
  for (const [w, k] of dias) { if (new RegExp("\\b" + w).test(n)) { const wd = parseD(t).getUTCDay(); let dd = (k - wd + 7) % 7; if (dd === 0) dd = 7; data = addDays(t, dd); break; } }
  const dm = txt.match(/\bdia\s+(\d{1,2})(?:\/(\d{1,2}))?/i);
  if (dm) { const m = dm[2] ? pad(+dm[2]) : t.slice(5, 7); let d = t.slice(0, 4) + "-" + m + "-" + pad(+dm[1]); if (d < t && !dm[2]) d = addMonth(t.slice(0, 7), 1) + "-" + pad(+dm[1]); if (d < t && dm[2]) d = (+t.slice(0, 4) + 1) + d.slice(4); data = d; }
  if (!data && !hora) return null;
  if (!data) data = t;
  const comp = /(reuniao|consulta|dentista|medic|call|entrevista|aniversario|festa|aula|exame|encontro|almoco com|jantar com|gravacao com|psicolog|terapia|manicure|salao)/.test(n);
  const titulo = (" " + txt + " ")
    .replace(/^\s*(me lembra de|me lembre de|lembrar de|lembra de|lembrete:?|anota:?|tarefa:?)\s+/i, " ")
    .replace(/\s(?:às|as|a partir das)\s+\d{1,2}(?:[:h]\d{0,2})?\s*(?:h|hs|horas)?(?=\s|$)/gi, " ")
    .replace(/\s\d{1,2}(?::\d{2}|h\d{0,2}|hs|\s?horas)(?=\s|$)/gi, " ")
    .replace(/\sdia\s+\d{1,2}(?:\/\d{1,2})?(?=\s|$)/gi, " ")
    .replace(/\s(?:depois de amanhã|depois de amanha|amanhã|amanha|hoje)(?=\s|$)/gi, " ")
    .replace(/\s(?:na |no )?(?:próxima |proxima |próximo |proximo )?(?:segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)(?:-feira)?(?=\s|$)/gi, " ")
    .replace(/\s+/g, " ").trim();
  return { tipo: comp ? "compromisso" : "tarefa", titulo: cap(titulo) || cap(txt), data, hora, rep: "nao", dur: comp ? 60 : 30 };
}
function parseLinha(l) {
  const x = l.replace(/^\s*[-•*·]\s*/, "").replace(/^\s*\d+[.)]\s+/, "").trim();
  const m = x.match(/^(.+?)[\s:=–-]+(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:reais)?(?:[\s,;–-]+(?:todo\s+)?(?:dia|vence(?:\s+(?:dia|em))?|vencimento)\s*(\d{1,2}))?\s*$/i);
  if (!m) return null;
  return { n: cap(m[1].trim().replace(/[:\-–]+$/, "").trim()), v: r2(parseNum(m[2])), d: m[3] ? Math.min(31, +m[3]) : null };
}

/* ====================== respostas ====================== */
function ajudaTxt(nome) {
  return `Oi, ${esc(nome)}! Eu sou a <b>Nina</b>, sua assistente do Rumo 💜\nMe manda o que precisar que eu anoto tudo pra você:\n\n<b>Pra anotar</b>\n• gastei 45 mercado\n• recebi 1200 cliente\n• dentista amanhã 15h\n• comprar ração sábado\n• tomei a injeção\n• feito academia\n• paguei a luz\n\n<b>Lista (uma coisa por linha)</b>\n<code>contas fixas\nAluguel 1700 dia 5\nInternet 119,90 dia 10</code>\n\n<b>Pra perguntar</b>\n• hoje  ·  amanhã\n• contas\n• quanto posso gastar\n• posso comprar tênis 300\n\nTudo que você manda aqui aparece no app na hora ✨`;
}
const naoEntendi = () => `Ops, essa eu não entendi 🙈 Me manda assim que eu consigo:\n\n• <b>gastei 45 mercado</b>\n• <b>dentista amanhã 15h</b>\n• <b>feito academia</b>\n• <b>hoje</b>  ·  <b>contas</b>  ·  <b>quanto posso gastar</b>\n\nOu manda <b>ajuda</b> pra ver tudo.`;

async function resumoDia(uid, d, manha) {
  const m = d.slice(0, 7);
  const D = await carregar(uid, ["perfil", "tarefas", "saude", "fin", "m:" + m]);
  const its = D.tarefas.items.filter((i) => ocorre(i, d)).sort((a, b) => (a.hora || "99") < (b.hora || "99") ? -1 : 1);
  const st = injStatus(D.saude);
  const linhas = its.map((i) => `${isDone(i, d) ? "✅" : isSkip(i, d) ? "➖" : "⬜️"} ${i.hora || "—"}  ${esc(i.titulo)}`);
  if (st && (st.prox === d || (st.prox < d && d === TODAY()))) linhas.push(`💉 ${D.saude.injecao.hora || "—"}  Tomar a ${esc(D.saude.injecao.nome || "injeção")}${st.prox < d ? " (atrasada)" : ""}`);
  const contas = D.fin.recorrentes.filter((r) => r.dia && recAtivo(r, m) && !(r.pagos || {})[m] && vence(r, m) === d);
  const f = fin(D.fin, D["m:" + m].tx || [], m);
  const nome = D.perfil.nome || "Thais";
  let t = manha ? `☀️ <b>Bom diaaa, ${esc(nome)}!</b> ${cap(fmtD(d))}\nOlha o que a gente tem hoje:\n\n` : `<b>${cap((d === TODAY() ? "hoje, " : d === addDays(TODAY(), 1) ? "amanhã, " : "") + fmtD(d))}</b>\n\n`;
  t += linhas.length ? linhas.join("\n") : "Nada marcado. Dia livre! 🌿";
  if (contas.length) t += `\n\n💳 Vence${d === TODAY() ? " hoje" : ""}: ${contas.map((r) => `${esc(r.nome)} ${brl(r.valor)}`).join(", ")}`;
  if (f.base > 0) t += `\n💰 Livre no mês: <b>${brl(f.livre)}</b>`;
  if (manha) t += `\n\nVai dar tudo certo, bora! 💪`;
  return t;
}

/* ====================== o que fazer com cada mensagem ====================== */
async function processar(conta, texto) {
  const chat = conta.chat_id, uid = conta.user_id, s = texto.trim(), n = norm(s), t = TODAY(), m = t.slice(0, 7);
  let mm;

  // listas: primeira linha diz o que é, depois uma coisa por linha
  const linhas = s.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (linhas.length > 1 && /(conta|fixa|gasto|despesa|compra|lancamento|lanca)/.test(norm(linhas[0])) && !NUM.test(linhas[0].replace(/\b(19|20)\d\d\b/, ""))) {
    const fixa = /(conta|fixa|mensal|todo mes)/.test(norm(linhas[0])) && !/gasto/.test(norm(linhas[0]));
    const ok = [], ruim = [];
    const D = await carregar(uid, ["fin"]);
    for (const l of linhas.slice(1)) { const p = parseLinha(l); if (p && p.v > 0) ok.push({ ...p, c: categorizar(p.n, D.fin.config) }); else ruim.push(l); }
    if (!ok.length) return falar(chat, `Não consegui ler nenhuma linha 🙈 Manda assim, uma por linha:\n\n<code>contas fixas\nAluguel 1700 dia 5\nInternet 119,90 dia 10</code>`);
    const tot = ok.reduce((a, x) => a + x.v, 0);
    let txt = (fixa ? `📋 <b>Achei ${ok.length} ${plural(ok.length, "conta fixa", "contas fixas")}</b> (todo mês)\n\n` : `🧾 <b>Achei ${ok.length} ${plural(ok.length, "gasto", "gastos")}</b> de hoje\n\n`) +
      ok.map((x) => `• ${esc(x.n)}: ${brl(x.v)}${fixa ? (x.d ? ` · dia ${x.d}` : " · <i>sem dia</i>") : ""} · ${esc(x.c)}`).join("\n") +
      `\n\nTotal: <b>${brl(tot)}</b>${fixa ? " por mês" : ""}`;
    if (ruim.length) txt += `\n\n⚠️ Não entendi: ${ruim.map((x) => `“${esc(x)}”`).join(", ")}`;
    if (fixa && ok.some((x) => !x.d)) txt += `\n\nAs que estão sem dia entram sem lembrete de vencimento. Dá pra completar depois no app.`;
    await sb.from("rumo_telegram").update({ pendente: { tipo: fixa ? "contas" : "gastos", itens: ok } }).eq("user_id", uid);
    return falar(chat, txt, [[["✅ Colocar no Rumo", "lista:ok"], ["Cancelar", "lista:no"]]]);
  }

  if (/^\/?(start|oi|ola|ajuda|help|menu|comandos|bom dia|boa tarde|boa noite)\b/.test(n)) {
    const D = await carregar(uid, ["perfil"]);
    return falar(chat, ajudaTxt(D.perfil.nome || "Thais"));
  }
  if (/^(hoje|meu dia|o que tenho hoje|agenda|resumo)$/.test(n)) return falar(chat, await resumoDia(uid, t, false));
  if (/^amanha$/.test(n)) return falar(chat, await resumoDia(uid, addDays(t, 1), false));

  if (/(tomei a injecao|tomei injecao|injecao tomada|tomei o anticoncepcional|tomei a vacina)/.test(n)) return registrarInjecao(conta, t);

  if ((mm = n.match(/^(feito|fiz|terminei|concluido|concluida|pronto)\s+(.+)$/))) {
    const D = await carregar(uid, ["tarefas"]);
    const alvo = mm[2].trim();
    const it = D.tarefas.items.filter((i) => ocorre(i, t)).find((i) => norm(i.titulo).includes(alvo)) || D.tarefas.items.filter((i) => !isRep(i) && !i.feito).find((i) => norm(i.titulo).includes(alvo));
    if (!it) return falar(chat, `Não achei “${esc(mm[2])}” no seu dia 🤔 Manda <b>hoje</b> pra ver a lista.`);
    marcarFeito(it, it.data && !isRep(it) ? it.data : t); await gravar(uid, "tarefas", D.tarefas);
    const faltam = D.tarefas.items.filter((i) => ocorre(i, t) && !isDone(i, t) && !isSkip(i, t)).length;
    return falar(chat, `Uhuul! ✅ <b>${esc(it.titulo)}</b> feito.\n${faltam ? `${plural(faltam, "Falta", "Faltam")} só ${faltam} ${plural(faltam, "coisinha", "coisinhas")} hoje.` : "Você zerou o dia! 🎉"}`);
  }

  if (/^contas?( da semana| do mes| fixas)?$/.test(n)) {
    const D = await carregar(uid, ["fin"]);
    const lst = [];
    for (const mes of [m, addMonth(m, 1)]) for (const r of D.fin.recorrentes) { if (!r.dia || !recAtivo(r, mes) || (r.pagos || {})[mes]) continue; const v = vence(r, mes); const f = diffDays(t, v); if (f <= 7 && (mes === m || f >= 0)) lst.push({ r, v, f }); }
    lst.sort((a, b) => (a.v < b.v ? -1 : 1));
    if (!lst.length) return falar(chat, "Nenhuma conta vencendo nos próximos 7 dias 🙌");
    const tot = lst.reduce((a, x) => a + (+x.r.valor || 0), 0);
    return falar(chat, `<b>Contas dos próximos 7 dias</b>\n\n${lst.map((x) => `• ${esc(x.r.nome)}: ${brl(x.r.valor)} (${x.f < 0 ? `<b>atrasada ${-x.f} ${plural(-x.f, "dia", "dias")}</b>` : x.f === 0 ? "<b>hoje</b>" : fmtD(x.v)})`).join("\n")}\n\nTotal: <b>${brl(tot)}</b>`,
      lst.slice(0, 6).map((x) => [[`✅ Paguei ${x.r.nome}`.slice(0, 40), `pagar:${x.r.id}:${x.v.slice(0, 7)}`]]));
  }

  if (/(quanto posso gastar|quanto tenho|quanto sobrou|quanto ta livre|quanto esta livre|^livre$|^saldo$|como estou de dinheiro|como to de dinheiro)/.test(n)) {
    const D = await carregar(uid, ["fin", "m:" + m]);
    const f = fin(D.fin, D["m:" + m].tx || [], m);
    if (!f.base) return falar(chat, "Ainda não sei quanto você recebe esse mês 🙈 Coloca a renda em <b>Dinheiro › Planejar › Orçamento › Editar plano</b> no app, ou me manda <b>recebi 3000 cliente</b>.");
    const resta = daysInMonth(m) - +t.slice(8) + 1;
    const estouros = (D.fin.config.cats || []).filter((c) => +c.orc && (f.porCat[c.n] || 0) > +c.orc).map((c) => `⚠️ ${esc(c.n)} já passou ${brl((f.porCat[c.n] || 0) - c.orc)} do plano.`);
    return falar(chat, `Em ${MES[+m.slice(5) - 1]} ainda tem <b>${brl(f.livre)}</b> livres.\n${f.livre > 0 ? `Dá uns <b>${brl(f.livre / resta)}</b> por dia até o fim do mês.` : "Tá no vermelho, vamos segurar um pouquinho 💜"}${estouros.length ? "\n\n" + estouros.join("\n") : ""}`);
  }

  if ((mm = s.match(/^posso comprar\s+(.*?)\s*(?:de|por|que custa|custando)?\s*(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:reais)?\s*\??$/i))) {
    const D = await carregar(uid, ["fin", "m:" + m]);
    const f = fin(D.fin, D["m:" + m].tx || [], m), v = parseNum(mm[2]), item = cap(mm[1] || "isso");
    const lim = (+D.fin.config.limite || 90) / 100, depois = f.livre - v, comprom = f.base ? (f.base - f.livre + v) / f.base : 1;
    if (!f.base) return falar(chat, "Ainda não sei sua renda do mês, então não consigo responder 🙈 Coloca em <b>Editar plano</b> no app.");
    if (depois >= 0 && comprom <= lim) return falar(chat, `✅ Pode! ${esc(item)} de ${brl(v)} cabe no mês e ainda sobram <b>${brl(depois)}</b>.`);
    return falar(chat, `✋ Melhor esperar. ${esc(item)} de ${brl(v)} ${depois < 0 ? `passaria ${brl(-depois)} do que está livre (${brl(f.livre)}).` : `deixaria o mês com ${Math.round(comprom * 100)}% da renda comprometida, e sua regra é até ${Math.round(lim * 100)}%.`}\n\nQue tal juntar aos pouquinhos numa meta? 💜`);
  }

  // pagar conta fixa pelo nome: "paguei a luz"
  if ((mm = n.match(/^(paguei|pago|ja paguei)\s+(?:a |o |as |os )?([a-z ]+)$/)) && !NUM.test(s)) {
    const D = await carregar(uid, ["fin"]);
    const r = D.fin.recorrentes.find((x) => norm(x.nome).includes(mm[2].trim()) || mm[2].includes(norm(x.nome)));
    if (r) return pagarConta(conta, r.id, m);
  }

  if ((mm = n.match(/^(gastei|paguei|comprei|gasto|recebi|ganhei|entrou|caiu|vendi)\b/))) {
    const p = parseLanc(s);
    if (!p.valor) return falar(chat, `Faltou o valor 🙈 Manda assim: <b>${mm[1]} 45 mercado</b>`);
    return lancar(conta, p);
  }

  const it = parseItem(s);
  if (it && it.titulo && norm(it.titulo).length > 1) {
    const D = await carregar(uid, ["tarefas"]);
    const novo = { id: novoId(), feitos: {}, passos: [], feito: false, etiqueta: "", local: "", ...it };
    D.tarefas.items.push(novo); await gravar(uid, "tarefas", D.tarefas);
    await sb.from("rumo_telegram").update({ ultimo: { tipo: "item", id: novo.id } }).eq("user_id", uid);
    return falar(chat, `Anotei! 📅 ${it.tipo === "compromisso" ? "Compromisso" : "Tarefa"}:\n<b>${esc(it.titulo)}</b>\n${cap(fmtD(it.data))}${it.hora ? " às " + it.hora : " (sem horário)"}${it.hora ? `\n\nVou te lembrar antes, tá? 💜` : ""}`, [[["Desfazer", `delitem:${novo.id}`]]]);
  }
  return falar(chat, naoEntendi());
}

function marcarFeito(i, d) { if (isRep(i)) { i.feitos = i.feitos || {}; i.feitos[d] = true; } else i.feito = true; }

async function lancar(conta, p) {
  const uid = conta.user_id, mes = p.data.slice(0, 7);
  const D = await carregar(uid, ["fin", "m:" + mes]);
  const cat = p.tipo === "entrada" ? catEntrada(p.desc) : categorizar(p.desc, D.fin.config);
  const tx = { id: novoId(), data: p.data, desc: p.desc, valor: r2(p.valor), tipo: p.tipo, cat, origem: "telegram", ok: cat !== "Outros" };
  D["m:" + mes].tx = [...(D["m:" + mes].tx || []), tx];
  await gravar(uid, "m:" + mes, D["m:" + mes]);
  const f = fin(D.fin, D["m:" + mes].tx, mes);
  const quando = p.data === TODAY() ? "" : ` (${p.data === addDays(TODAY(), -1) ? "ontem" : fmtD(p.data)})`;
  const livre = f.base > 0 ? `\n\nAinda livre em ${MES[+mes.slice(5) - 1]}: <b>${brl(f.livre)}</b>` : "";
  if (p.tipo === "entrada") return falar(conta.chat_id, `Oba! 💰 Entrada de <b>${brl(tx.valor)}</b>${tx.desc !== "Entrada" ? " (" + esc(tx.desc) + ")" : ""}${quando} lançada.${livre}`, [[["Desfazer", `deltx:${tx.id}:${mes}`]]]);
  return falar(conta.chat_id, `Anotadinho! 💸 <b>${brl(tx.valor)}</b> em ${esc(tx.desc)}${quando}\nCategoria: <b>${esc(cat)}</b>${livre}`, [[["Trocar categoria", `cats:${tx.id}:${mes}`], ["Desfazer", `deltx:${tx.id}:${mes}`]]]);
}

async function registrarInjecao(conta, d) {
  const D = await carregar(conta.user_id, ["saude"]);
  const j = D.saude.injecao;
  if (!j.historico.includes(d)) j.historico.push(d);
  j.historico.sort(); j.ultima = j.historico[j.historico.length - 1];
  await gravar(conta.user_id, "saude", D.saude);
  const prox = addDays(j.ultima, +j.intervalo || 30);
  return falar(conta.chat_id, `💉 Prontinho, injeção registrada! Orgulho de você 💜\nA próxima é <b>${fmtD(prox)}</b>, e eu te lembro na véspera.`);
}

async function pagarConta(conta, rid, mes) {
  const D = await carregar(conta.user_id, ["fin", "m:" + mes]);
  const r = D.fin.recorrentes.find((x) => x.id === rid);
  if (!r) return falar(conta.chat_id, "Não achei essa conta 🤔");
  if ((r.pagos || {})[mes]) return falar(conta.chat_id, `A ${esc(r.nome)} de ${MES[+mes.slice(5) - 1]} já estava paga ✅`);
  r.pagos = { ...(r.pagos || {}), [mes]: true };
  const dia = mes === TODAY().slice(0, 7) ? TODAY() : mes + "-" + pad(Math.min(+r.dia || 1, daysInMonth(mes)));
  D["m:" + mes].tx = [...(D["m:" + mes].tx || []), { id: novoId(), data: dia, desc: r.nome, valor: +r.valor || 0, tipo: "saida", cat: r.cat || "Outros", origem: "recorrente", ok: true }];
  await gravar(conta.user_id, "fin", D.fin); await gravar(conta.user_id, "m:" + mes, D["m:" + mes]);
  return falar(conta.chat_id, `✅ ${esc(r.nome)} paga! ${brl(r.valor)} já entrou nos gastos de ${MES[+mes.slice(5) - 1]}.`);
}

/* ====================== botões ====================== */
async function botao(conta, q) {
  const [acao, a, b] = String(q.data || "").split(":");
  const uid = conta.user_id, chat = conta.chat_id;
  const fecha = (txt) => tg("answerCallbackQuery", { callback_query_id: q.id, text: txt || "" });
  const tiraBotoes = () => q.message && tg("editMessageReplyMarkup", { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
  if (acao === "lista") {
    const p = conta.pendente; await tiraBotoes();
    if (a !== "ok" || !p) { await sb.from("rumo_telegram").update({ pendente: null }).eq("user_id", uid); await fecha(); return falar(chat, "Cancelado, nada foi salvo 👍"); }
    const t = TODAY(), m = t.slice(0, 7);
    if (p.tipo === "contas") {
      const D = await carregar(uid, ["fin"]);
      for (const x of p.itens) D.fin.recorrentes.push({ id: novoId(), nome: x.n, valor: x.v, dia: x.d || null, cat: x.c, tipo: "conta", inicioMes: m, pagos: {} });
      await gravar(uid, "fin", D.fin);
      await sb.from("rumo_telegram").update({ pendente: null }).eq("user_id", uid); await fecha("Salvo!");
      return falar(chat, `Feito! 💜 Coloquei ${p.itens.length === 1 ? "a conta" : `as ${p.itens.length} contas`} no Rumo. Te aviso 2 dias antes de cada vencimento, pode deixar.`);
    }
    const D = await carregar(uid, ["fin", "m:" + m]);
    for (const x of p.itens) D["m:" + m].tx.push({ id: novoId(), data: t, desc: x.n, valor: x.v, tipo: "saida", cat: x.c, origem: "telegram", ok: x.c !== "Outros" });
    await gravar(uid, "m:" + m, D["m:" + m]);
    await sb.from("rumo_telegram").update({ pendente: null }).eq("user_id", uid); await fecha("Salvo!");
    const f = fin(D.fin, D["m:" + m].tx, m);
    return falar(chat, `Pronto! ${p.itens.length} ${plural(p.itens.length, "gasto lançado", "gastos lançados")} 💸${f.base > 0 ? `\nLivre no mês: <b>${brl(f.livre)}</b>` : ""}`);
  }
  if (acao === "feito") {
    const D = await carregar(uid, ["tarefas"]); const i = D.tarefas.items.find((x) => x.id === a);
    await tiraBotoes();
    if (!i) { await fecha("Não achei 🤔"); return; }
    marcarFeito(i, b || TODAY()); await gravar(uid, "tarefas", D.tarefas); await fecha("Feito ✅");
    return falar(chat, `Uhuul! ✅ <b>${esc(i.titulo)}</b> feito.`);
  }
  if (acao === "adiar") {
    const { data: l } = await sb.from("rumo_lembretes").select("titulo,corpo,chave").eq("id", +a).maybeSingle();
    await tiraBotoes();
    if (l) await sb.from("rumo_lembretes").insert({ user_id: uid, chave: "adiar:" + l.chave.replace(/^adiar:/, "").split("|")[0] + "|" + Date.now(), quando: new Date(Date.now() + 30 * 60000).toISOString(), titulo: l.titulo, corpo: l.corpo, enviado: true, enviado_tg: false });
    await fecha("Te lembro em 30 min ⏰");
    return falar(chat, "Combinado! Te lembro de novo daqui a 30 minutinhos ⏰");
  }
  if (acao === "inj") { await tiraBotoes(); await fecha("Registrada 💉"); return registrarInjecao(conta, TODAY()); }
  if (acao === "pagar") { await tiraBotoes(); await fecha(); return pagarConta(conta, a, b); }
  if (acao === "deltx") {
    const D = await carregar(uid, ["m:" + b]); const antes = D["m:" + b].tx.length;
    D["m:" + b].tx = D["m:" + b].tx.filter((x) => x.id !== a); await tiraBotoes();
    if (D["m:" + b].tx.length === antes) { await fecha("Já tinha saído"); return; }
    await gravar(uid, "m:" + b, D["m:" + b]); await fecha("Apagado"); return falar(chat, "Apaguei esse lançamento 👍");
  }
  if (acao === "delitem") {
    const D = await carregar(uid, ["tarefas"]); D.tarefas.items = D.tarefas.items.filter((x) => x.id !== a);
    await gravar(uid, "tarefas", D.tarefas); await tiraBotoes(); await fecha("Apagado"); return falar(chat, "Apaguei 👍");
  }
  if (acao === "cats") {
    const D = await carregar(uid, ["fin"]);
    const nomes = (D.fin.config.cats || []).map((c) => c.n).filter(Boolean);
    const lista = nomes.length ? nomes : Object.keys(KW).concat("Outros");
    await fecha();
    const linhas = []; for (let i = 0; i < lista.length; i += 2) linhas.push(lista.slice(i, i + 2).map((c, k) => [c, `cat:${a}:${b}|${i + k}`]));
    return tg("editMessageReplyMarkup", { chat_id: chat, message_id: q.message.message_id, reply_markup: kb(linhas) });
  }
  if (acao === "cat") {
    const [mes, idx] = String(b).split("|");
    const D = await carregar(uid, ["fin", "m:" + mes]);
    const nomes = (D.fin.config.cats || []).map((c) => c.n).filter(Boolean);
    const lista = nomes.length ? nomes : Object.keys(KW).concat("Outros");
    const nova = lista[+idx]; const tx = D["m:" + mes].tx.find((x) => x.id === a);
    await tiraBotoes();
    if (!tx || !nova) { await fecha("Não achei 🤔"); return; }
    tx.cat = nova; tx.ok = true;
    const chave = norm(tx.desc).split(" ").slice(0, 2).join(" ");
    if (chave) D.fin.config.regras = { ...(D.fin.config.regras || {}), [chave]: nova };
    await gravar(uid, "m:" + mes, D["m:" + mes]); await gravar(uid, "fin", D.fin); await fecha("Trocado!");
    return falar(chat, `Pronto, mudei pra <b>${esc(nova)}</b>. Da próxima vez que aparecer “${esc(tx.desc)}”, já coloco aí 😉`);
  }
  await fecha();
}

/* ====================== avisos agendados (resumo, lembretes, injeção, contas) ====================== */
async function enviarAvisos() {
  const agora = new Date(), desde = new Date(agora.getTime() - 30 * 60000).toISOString();
  await sb.from("rumo_lembretes").update({ enviado_tg: true }).eq("enviado_tg", false).lt("quando", desde);
  const { data: devidos } = await sb.from("rumo_lembretes").update({ enviado_tg: true }).eq("enviado_tg", false).lte("quando", agora.toISOString()).select("id,user_id,titulo,corpo,chave");
  if (!devidos || !devidos.length) return 0;
  const ids = [...new Set(devidos.map((l) => l.user_id))];
  const { data: contas } = await sb.from("rumo_telegram").select("user_id,chat_id").in("user_id", ids).not("chat_id", "is", null);
  let n = 0;
  for (const l of devidos) {
    const c = (contas || []).find((x) => x.user_id === l.user_id); if (!c) continue;
    const k = l.chave.replace(/^adiar:/, "").split("|")[0];
    try {
      if (k.startsWith("r:")) { await falar(c.chat_id, await resumoDia(l.user_id, k.slice(2), true)); }
      else if (k.startsWith("i:")) {
        const [, id, d] = k.split(":");
        const D = await carregar(l.user_id, ["tarefas"]); const it = D.tarefas.items.find((x) => x.id === id);
        if (!it || isDone(it, d) || isSkip(it, d)) continue;
        const denovo = l.chave.startsWith("adiar:");
        await falar(c.chat_id, `⏰ ${denovo ? "Lembrando de novo: " : ""}<b>${esc(it.titulo)}</b>\n${denovo ? (it.hora ? "Era às " + it.hora : "") : esc(l.corpo || "")}`, [[["✅ Feito", `feito:${id}:${d}`], ["⏰ +30 min", `adiar:${l.id}`]]]);
      }
      else if (k.startsWith("inj-1:")) await falar(c.chat_id, `💉 Ei! <b>${esc(l.titulo)}</b>\nJá deixa ela separadinha. Amanhã às 9h eu te lembro de novo, tá? 💜`);
      else if (k.startsWith("inj:")) await falar(c.chat_id, `💉 <b>${esc(l.titulo)}</b>\nQuando tomar, é só tocar aqui embaixo 💜`, [[["💉 Já tomei", "inj"], ["⏰ +30 min", `adiar:${l.id}`]]]);
      else if (k.startsWith("c:") || k.startsWith("c2:")) { const [, rid, mes] = k.split(":"); await falar(c.chat_id, `💳 <b>${esc(l.titulo)}</b>\n${esc(l.corpo || "")}`, [[["✅ Paguei", `pagar:${rid}:${mes}`]]]); }
      else await falar(c.chat_id, `⏰ <b>${esc(l.titulo)}</b>${l.corpo ? "\n" + esc(l.corpo) : ""}`);
      n++;
    } catch (_) { /* segue pros próximos */ }
  }
  return n;
}

/* ====================== portas de entrada ====================== */
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url), acao = url.searchParams.get("acao");
  if (!TOKEN) return json({ erro: "Falta o segredo TELEGRAM_TOKEN" }, 500);

  if (acao === "info") { const r = await tg("getMe", {}); return json({ ok: r.ok, usuario: r.result?.username || null }); }
  if (acao === "setup") {
    const base = String(Deno.env.get("SUPABASE_URL")).replace(/\/$/, "") + "/functions/v1/nina";
    const w = await tg("setWebhook", { url: base, secret_token: await segredo(), allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
    await tg("setMyCommands", { commands: [{ command: "hoje", description: "Seu dia" }, { command: "contas", description: "Contas dos próximos 7 dias" }, { command: "ajuda", description: "O que eu sei fazer" }] });
    await tg("setMyDescription", { description: "Oi! Eu sou a Nina, sua assistente do Rumo 💜 Anoto gastos, tarefas e compromissos e te lembro do que importa." });
    await tg("setMyShortDescription", { short_description: "Sua assistente do Rumo 💜" });
    const me = await tg("getMe", {});
    return json({ webhook: w.ok, descricao: w.description, usuario: me.result?.username });
  }
  if (acao === "cron") { return json({ enviados: await enviarAvisos() }); }

  // daqui pra baixo só o Telegram entra
  if (req.headers.get("x-telegram-bot-api-secret-token") !== (await segredo())) return json({ erro: "proibido" }, 403);
  let up; try { up = await req.json(); } catch { return json({ ok: true }); }
  try {
    const msg = up.message, q = up.callback_query;
    const chat = msg?.chat?.id ?? q?.message?.chat?.id; if (!chat) return json({ ok: true });
    if (msg && msg.chat.type !== "private") return json({ ok: true });
    const texto = String(msg?.text || "").trim();

    // ligar a conta: /start CODIGO (vem do botão do app)
    const st = texto.match(/^\/start\s+([A-Za-z0-9_-]{6,40})$/);
    if (st) {
      const { data: row } = await sb.from("rumo_telegram").select("user_id").eq("codigo", st[1]).maybeSingle();
      if (!row) { await falar(chat, "Esse link já foi usado ou expirou 🙈 Abre o Rumo › Ajustes › <b>Ligar a Nina</b> e toca de novo."); return json({ ok: true }); }
      await sb.from("rumo_telegram").update({ chat_id: null }).eq("chat_id", chat).neq("user_id", row.user_id);
      await sb.from("rumo_telegram").update({ chat_id: chat, codigo: null, nome_tg: msg.from?.first_name || null }).eq("user_id", row.user_id);
      const D = await carregar(row.user_id, ["perfil"]);
      D.perfil.telegram = true; await gravar(row.user_id, "perfil", D.perfil);
      await falar(chat, `Ebaaa, ligamos! 🎉\n\n${ajudaTxt(D.perfil.nome || "Thais")}`);
      return json({ ok: true });
    }

    const { data: conta } = await sb.from("rumo_telegram").select("user_id,chat_id,pendente,ultimo").eq("chat_id", chat).maybeSingle();
    if (!conta) { await falar(chat, "Oi! Eu sou a Nina 💜 Pra gente começar, abre o Rumo › Ajustes › <b>Ligar a Nina</b>."); return json({ ok: true }); }
    if (q) await botao(conta, q);
    else if (texto) await processar(conta, texto.replace(/^\/(hoje|contas|ajuda)(@\w+)?$/i, "$1"));
    else if (msg) await falar(chat, "Por enquanto eu só entendo texto 🙈 Escreve pra mim que eu anoto!");
  } catch (e) {
    try { const chat = up.message?.chat?.id ?? up.callback_query?.message?.chat?.id; if (chat) await falar(chat, "Ops, deu um errinho aqui do meu lado 😵‍💫 Tenta de novo daqui a pouco?"); } catch (_) { /* nada */ }
    console.error(e);
  }
  return json({ ok: true });
});

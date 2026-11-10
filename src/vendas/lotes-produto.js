/* =====================================================================
   FPSS 2027 — LOTES DE PREÇO POR PRODUTO
   SQL: database/2026-11-09-produto-lotes.sql

   Regras:
   - lote vigente = ativo && data ok (vale até o fim do dia "valido_ate",
     horário de Rolim de Moura) && saldo (limite - vendido - reservado) > 0
   - lote atual = primeiro vigente, na ordem
   - compra maior que o saldo do lote atual é dividida no(s) próximo(s)
   - produto SEM nenhum lote ativo usa produtos.preco (como sempre)
   - produto COM lotes mas nenhum vigente fica indisponível
===================================================================== */

const FUSO = "America/Porto_Velho";

function arred(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

/* "AAAA-MM-DD" de hoje em Rolim de Moura */
function hojeLocal(agora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(agora);
  return partes; // en-CA => AAAA-MM-DD
}

/* Calcula situação de um lote. `uso` = {vendido, reservado} */
function situacaoDoLote(lote, uso, hoje) {
  const vendido = Number(uso?.vendido || 0);
  const reservado = Number(uso?.reservado || 0);
  const limite = lote.quantidade_limite == null ? null : Number(lote.quantidade_limite);
  const restante = limite == null ? null : Math.max(limite - vendido - reservado, 0);
  const dataVencida = !!lote.valido_ate && String(lote.valido_ate).slice(0, 10) < hoje;
  const esgotado = restante !== null && restante <= 0;
  const vigente = lote.ativo === true && !dataVencida && !esgotado;
  let motivo = null;
  if (!lote.ativo) motivo = "desativado";
  else if (dataVencida) motivo = "data vencida";
  else if (esgotado) motivo = "esgotado";
  return {
    ...lote,
    preco: arred(lote.preco),
    vendido, reservado, restante,
    vigente, motivo
  };
}

/* Carrega lotes (já com situação) de vários produtos. Retorna Map(produto_id -> lotes[]) */
async function carregarLotes(supabase, produtoIds, { incluirInativos = false } = {}) {
  const mapa = new Map();
  const ids = [...new Set((produtoIds || []).filter(Boolean))];
  if (!ids.length) return mapa;

  let consulta = supabase
    .from("produto_lotes")
    .select("id,produto_id,nome,preco,quantidade_limite,valido_ate,ordem,ativo")
    .in("produto_id", ids)
    .order("ordem", { ascending: true })
    .order("id", { ascending: true });
  if (!incluirInativos) consulta = consulta.eq("ativo", true);
  const { data: lotes, error } = await consulta;
  if (error) {
    /* tabela ainda não criada: tudo funciona como antes (sem lotes) */
    if (/produto_lotes|does not exist|schema cache/i.test(error.message || "")) return mapa;
    throw new Error("Erro ao carregar lotes: " + error.message);
  }
  if (!lotes || !lotes.length) return mapa;

  const usoPorLote = new Map();
  const { data: usos, error: e2 } = await supabase.rpc("fpss_produto_lotes_uso", { p_produto_ids: ids });
  if (e2) throw new Error("Erro ao conferir vendas dos lotes: " + e2.message);
  for (const u of usos || []) usoPorLote.set(Number(u.lote_id), u);

  const hoje = hojeLocal();
  for (const l of lotes) {
    const lista = mapa.get(l.produto_id) || [];
    lista.push(situacaoDoLote(l, usoPorLote.get(Number(l.id)), hoje));
    mapa.set(l.produto_id, lista);
  }
  return mapa;
}

/* Lote atual (primeiro vigente) ou null */
function loteAtual(lotes) {
  return (lotes || []).find(l => l.vigente) || null;
}

/* Quantas unidades ainda cabem somando os lotes vigentes (Infinity = sem limite) */
function saldoTotal(lotes) {
  let total = 0;
  for (const l of lotes || []) {
    if (!l.vigente) continue;
    if (l.restante === null) return Infinity;
    total += l.restante;
  }
  return total;
}

/* Divide `qtd` entre os lotes vigentes, na ordem.
   Retorna { faixas: [{lote, quantidade}], faltou } */
function alocarQuantidade(lotes, qtd) {
  const faixas = [];
  let falta = qtd;
  for (const l of lotes || []) {
    if (falta <= 0) break;
    if (!l.vigente) continue;
    const cabe = l.restante === null ? falta : Math.min(l.restante, falta);
    if (cabe <= 0) continue;
    faixas.push({ lote: l, quantidade: cabe });
    falta -= cabe;
  }
  return { faixas, faltou: Math.max(falta, 0) };
}

/* Resumo público de um lote (sem expor números internos demais) */
function lotePublico(l) {
  return {
    id: l.id,
    nome: l.nome,
    preco: l.preco,
    restante: l.restante,
    valido_ate: l.valido_ate || null
  };
}

/* Grava lote_id / lote_nome nos itens do pedido recém-criado.
   Os itens foram inseridos na mesma ordem de `itens`. */
async function gravarLotesNosItens(supabase, pedidoId, itens) {
  try {
    if (!itens.some(i => i.lote_id)) return;
    const { data: linhas, error } = await supabase
      .from("pedido_itens").select("id").eq("pedido_id", pedidoId).order("id", { ascending: true });
    if (error) { console.error("[LOTES] gravar lote nos itens:", error.message); return; }
    for (let k = 0; k < itens.length && k < (linhas || []).length; k++) {
      if (!itens[k].lote_id) continue;
      const { error: e2 } = await supabase.from("pedido_itens")
        .update({ lote_id: itens[k].lote_id, lote_nome: itens[k].lote_nome || null })
        .eq("id", linhas[k].id);
      if (e2) console.error("[LOTES] gravar lote no item:", e2.message);
    }
  } catch (e) {
    console.error("[LOTES] gravar lote nos itens:", e.message);
  }
}

module.exports = {
  hojeLocal,
  situacaoDoLote,
  carregarLotes,
  loteAtual,
  saldoTotal,
  alocarQuantidade,
  lotePublico,
  gravarLotesNosItens
};

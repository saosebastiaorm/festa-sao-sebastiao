/* =====================================================
   ARQUIVO: src/contatos/contatos.js
   Tela do admin "Contatos (WhatsApp)": junta, sem repetir, os
   telefones de quem compra cartela, recebe blocos, vende cartela,
   faz pedidos (churrasco etc.), entrou no Grupo VIP ou respondeu a
   enquete. Só LEITURA. Protegida por exigirPagina("contatos").
===================================================== */
function registrarRotasContatos(app, { supabase, exigirPagina, criarLimitador }) {
  const acesso = exigirPagina("contatos");
  const limite = criarLimitador({ janelaMs: 60 * 1000, max: 30 });

  /* telefone brasileiro → só dígitos com 55; null se não der para usar */
  function normalizar(v) {
    let d = String(v ?? "").replace(/\D/g, "");
    if (d.startsWith("0")) d = d.replace(/^0+/, "");
    if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
    if (d.length !== 10 && d.length !== 11) return null;
    if (d.length === 11 && d[2] !== "9") return null;      /* 11 dígitos precisam ser celular (9...) */
    if (d.length === 10 && /[2-5]/.test(d[2])) return null;  /* telefone fixo (começa com 2 a 5) não tem WhatsApp */
    return "55" + d;
  }

  async function lerTudo(tabela, colunas, filtro) {
    const POR = 1000, MAX = 30000;
    let tudo = [];
    for (let de = 0; de < MAX; de += POR) {
      let q = supabase.from(tabela).select(colunas).range(de, de + POR - 1);
      if (filtro) q = filtro(q);
      const { data, error } = await q;
      if (error) return { erro: error.message, linhas: [] };
      tudo = tudo.concat(data || []);
      if (!data || data.length < POR) break;
    }
    return { linhas: tudo };
  }

  app.get("/admin/contatos", limite, acesso, async (req, res) => {
    const avisos = [];
    const fontes = await Promise.all([
      lerTudo("cartelas", "nome_comprador, whatsapp_comprador, criado_em, data_pagamento", q => q.eq("status", "pago")),
      lerTudo("blocos_responsaveis", "nome, telefone, comunidade, provisorio, created_at"),
      lerTudo("vendedores_cartela", "nome, telefone, ativo, created_at"),
      lerTudo("pedidos", "nome, sobrenome, telefone, produto_tipo, status_pagamento, reembolsado_em, created_at", q => q.eq("status_pagamento", "pago").is("reembolsado_em", null)),
      lerTudo("vip", "nome, whatsapp, created_at"),
      lerTudo("enquetes", "nome, whatsapp, created_at")
    ]);
    const [cart, resp, vend, ped, vip, enq] = fontes;
    ["cartelas", "blocos_responsaveis", "vendedores_cartela", "pedidos", "vip", "enquetes"].forEach((n, i) => {
      if (fontes[i].erro) { console.error("[CONTATOS]", n, fontes[i].erro); avisos.push(`Não foi possível ler "${n}".`); }
    });

    const mapa = new Map();
    let semTelefoneValido = 0;
    function add(classe, nome, tel, detalhe, quando) {
      const t = normalizar(tel);
      if (!t) { if (String(tel ?? "").replace(/\D/g, "").length) semTelefoneValido++; return; }
      let c = mapa.get(t);
      if (!c) { c = { telefone: t, nome: "", classes: new Set(), detalhes: new Set(), primeiro: null, ultimo: null }; mapa.set(t, c); }
      const ms = quando ? new Date(quando).getTime() : NaN;
      if (Number.isFinite(ms)) { if (c.primeiro === null || ms < c.primeiro) c.primeiro = ms; if (c.ultimo === null || ms > c.ultimo) c.ultimo = ms; }
      const n = String(nome ?? "").replace(/\s+/g, " ").trim();
      if (n && n.length > c.nome.length) c.nome = n;
      c.classes.add(classe);
      if (detalhe) c.detalhes.add(String(detalhe).trim());
    }
    cart.linhas.forEach(r => add("compradores_cartela", r.nome_comprador, r.whatsapp_comprador, null, r.data_pagamento || r.criado_em));
    resp.linhas.filter(r => !r.provisorio).forEach(r => add("responsaveis_blocos", r.nome, r.telefone, r.comunidade, r.created_at));
    vend.linhas.filter(r => r.ativo !== false).forEach(r => add("vendedores", r.nome, r.telefone, null, r.created_at));
    ped.linhas.forEach(r => add("pedidos", [r.nome, r.sobrenome].filter(Boolean).join(" "), r.telefone, r.produto_tipo, r.created_at));
    vip.linhas.forEach(r => add("vip", r.nome, r.whatsapp, null, r.created_at));
    enq.linhas.forEach(r => add("enquete", r.nome, r.whatsapp, null, r.created_at));

    const contatos = [...mapa.values()]
      .map(c => ({ nome: c.nome, telefone: c.telefone, classes: [...c.classes], detalhes: [...c.detalhes].join(" · "),
        primeiro_registro: c.primeiro ? new Date(c.primeiro).toISOString() : null, ultimo_registro: c.ultimo ? new Date(c.ultimo).toISOString() : null }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    res.json({ sucesso: true, total: contatos.length, sem_telefone_valido: semTelefoneValido, avisos, contatos });
  });
}

module.exports = { registrarRotasContatos };

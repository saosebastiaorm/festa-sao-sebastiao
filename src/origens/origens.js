/* =====================================================================
   ORIGEM DAS VISITAS — de onde chegam os visitantes (Instagram, sites
   parceiros, WhatsApp…) e quais compras vieram de cada origem.

   Público (sem login):
     POST /api/origem/visita   { origem, meio, campanha, pagina }
       → soma +1 na contagem do dia (só números; nenhum dado pessoal)
     POST /api/origem/compra   { txid, tipo, origem, meio, campanha }
       → liga um Pix gerado à origem (só se o visitante permitiu o cookie
         "Parcerias"; o navegador só manda quando tem permissão)
   Admin (tela "Origem das visitas", chave "origens"):
     GET    /admin/origens?de=AAAA-MM-DD&ate=AAAA-MM-DD
     GET    /admin/origens/links      POST /admin/origens/links
     DELETE /admin/origens/links/:id
   Tabelas: origem_visitas, origem_compras, origem_links (SQL 2026-10-06).
===================================================================== */

function limparChave(v, max) {
  return String(v ?? "").toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "")
    .slice(0, max || 60);
}
function limparPagina(v) {
  let p = String(v ?? "").split("?")[0].split("#")[0].trim();
  if (!p.startsWith("/")) p = "/" + p;
  return p.replace(/[^a-zA-Z0-9/._-]/g, "").replace(/\.html$/, "").slice(0, 80) || "/";
}
function limparTexto(v, max) {
  return String(v ?? "").replace(/[<>]/g, "").trim().slice(0, max || 80);
}
function dataISO(v, padrao) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : padrao;
}

function registrarRotasOrigens(app, { supabase, exigirPagina, criarLimitador }) {

  const limitadorVisita = criarLimitador({ janelaMs: 60 * 1000, max: 60 });
  const acesso = exigirPagina("origens");

  app.post("/api/origem/visita", limitadorVisita, async (req, res) => {
    const b = req.body || {};
    const origem = limparChave(b.origem, 60) || "direto";
    const { error } = await supabase.rpc("fpss_origem_visita", {
      p_origem: origem,
      p_meio: limparChave(b.meio, 40),
      p_campanha: limparChave(b.campanha, 60),
      p_pagina: limparPagina(b.pagina)
    });
    if (error) console.error("[ORIGEM] erro ao contar visita:", error.message);
    res.status(204).end();
  });

  app.post("/api/origem/compra", limitadorVisita, async (req, res) => {
    const b = req.body || {};
    const txid = String(b.txid || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
    const tipo = b.tipo === "cartela" ? "cartela" : b.tipo === "produto" ? "produto" : null;
    const origem = limparChave(b.origem, 60);
    if (!txid || !tipo || !origem) return res.status(204).end();
    const { error } = await supabase.from("origem_compras").upsert({
      txid, tipo, origem, meio: limparChave(b.meio, 40), campanha: limparChave(b.campanha, 60)
    }, { onConflict: "txid", ignoreDuplicates: true });
    if (error) console.error("[ORIGEM] erro ao registrar compra:", error.message);
    res.status(204).end();
  });

  /* ------------------------------ relatório ------------------------------ */
  app.get("/admin/origens", acesso, async (req, res) => {
    const hoje = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10); // Rondônia (UTC-4)
    const trintaAtras = new Date(Date.now() - 4 * 3600 * 1000 - 29 * 86400000).toISOString().slice(0, 10);
    const de = dataISO(req.query.de, trintaAtras);
    const ate = dataISO(req.query.ate, hoje);

    const { data: vis, error: ev } = await supabase.from("origem_visitas")
      .select("dia, origem, meio, campanha, pagina, visitas")
      .gte("dia", de).lte("dia", ate).limit(20000);
    if (ev) {
      console.error("[ORIGEM] relatório:", ev);
      return res.status(500).json({ sucesso: false, erro: "Tabela de origens não encontrada. Rode no Supabase o SQL 2026-10-06-perfis-e-origens.sql." });
    }

    const { data: comp } = await supabase.from("origem_compras")
      .select("txid, tipo, origem, meio, campanha, criado_em")
      .gte("criado_em", de + "T00:00:00-04:00").lte("criado_em", ate + "T23:59:59-04:00").limit(10000);

    // situação dos Pix: pedidos (produtos) pelo txid e cartelas pelo pix_id
    const pagos = {};
    const txProdutos = (comp || []).filter(c => c.tipo === "produto").map(c => c.txid);
    const txCartelas = (comp || []).filter(c => c.tipo === "cartela").map(c => c.txid);
    for (let i = 0; i < txProdutos.length; i += 200) {
      const { data } = await supabase.from("pedidos").select("txid, status_pagamento, valor_total").in("txid", txProdutos.slice(i, i + 200));
      (data || []).forEach(p => { if (p.status_pagamento === "pago") pagos[p.txid] = Number(p.valor_total || 0); });
    }
    for (let i = 0; i < txCartelas.length; i += 200) {
      const { data } = await supabase.from("cartelas").select("pix_id, status, valor_pago").in("pix_id", txCartelas.slice(i, i + 200));
      (data || []).forEach(c => { if (c.status === "pago") pagos[c.pix_id] = (pagos[c.pix_id] || 0) + Number(c.valor_pago || 0); });
    }

    const porOrigem = {};
    const linha = (o) => (porOrigem[o] = porOrigem[o] || { origem: o, visitas: 0, pix: 0, pagos: 0, valor: 0, campanhas: {} });
    (vis || []).forEach(v => {
      const l = linha(v.origem);
      l.visitas += v.visitas;
      const ch = [v.meio, v.campanha].filter(Boolean).join(" · ");
      if (ch) l.campanhas[ch] = (l.campanhas[ch] || 0) + v.visitas;
    });
    (comp || []).forEach(c => {
      const l = linha(c.origem);
      l.pix += 1;
      if (pagos[c.txid] !== undefined) { l.pagos += 1; l.valor += pagos[c.txid]; }
    });

    const porDia = {};
    (vis || []).forEach(v => { porDia[v.dia] = (porDia[v.dia] || 0) + v.visitas; });
    const porPagina = {};
    (vis || []).forEach(v => { porPagina[v.pagina || "/"] = (porPagina[v.pagina || "/"] || 0) + v.visitas; });

    const origens = Object.values(porOrigem)
      .map(l => ({ ...l, valor: Math.round(l.valor * 100) / 100, campanhas: Object.entries(l.campanhas).sort((a, b) => b[1] - a[1]).slice(0, 8) }))
      .sort((a, b) => b.visitas - a.visitas);

    res.json({
      sucesso: true, de, ate,
      totais: {
        visitas: origens.reduce((s, l) => s + l.visitas, 0),
        pix: origens.reduce((s, l) => s + l.pix, 0),
        pagos: origens.reduce((s, l) => s + l.pagos, 0),
        valor: Math.round(origens.reduce((s, l) => s + l.valor, 0) * 100) / 100
      },
      origens,
      por_dia: Object.entries(porDia).sort((a, b) => a[0].localeCompare(b[0])).map(([dia, visitas]) => ({ dia, visitas })),
      por_pagina: Object.entries(porPagina).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([pagina, visitas]) => ({ pagina, visitas }))
    });
  });

  /* ----------------------------- links salvos ----------------------------- */
  app.get("/admin/origens/links", acesso, async (req, res) => {
    const { data, error } = await supabase.from("origem_links").select("*").order("criado_em", { ascending: false }).limit(500);
    if (error) return res.status(500).json({ sucesso: false, erro: "Erro ao carregar os links (rodou o SQL 2026-10-06?)." });
    res.json({ sucesso: true, links: data || [] });
  });

  app.post("/admin/origens/links", acesso, async (req, res) => {
    const b = req.body || {};
    const nome = limparTexto(b.nome, 80);
    const origem = limparChave(b.origem, 60);
    if (!nome || !origem) return res.status(400).json({ sucesso: false, erro: "Informe o nome e a origem." });
    const { data, error } = await supabase.from("origem_links").insert({
      nome, origem, meio: limparChave(b.meio, 40), campanha: limparChave(b.campanha, 60),
      destino: limparPagina(b.destino), criado_por: req.nomeUsuario || null
    }).select().single();
    if (error) return res.status(500).json({ sucesso: false, erro: error.message });
    res.json({ sucesso: true, link: data });
  });

  app.delete("/admin/origens/links/:id", acesso, async (req, res) => {
    const { error } = await supabase.from("origem_links").delete().eq("id", Number(req.params.id));
    if (error) return res.status(500).json({ sucesso: false, erro: error.message });
    res.json({ sucesso: true });
  });
}

module.exports = { registrarRotasOrigens };

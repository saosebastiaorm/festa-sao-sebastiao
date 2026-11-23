/* =====================================================================
   ARQUIVO: src/paroquia/paroquia.js   (2026-11-22)
   Recebimento da paróquia: a paróquia recebe os blocos devolvidos pelas
   comunidades e depois repassa (dinheiro + cartelas de papel) à equipe.

   - Tela "Paróquia" (chave de acesso "paroquia"): receber blocos, ver o
     que já recebeu / repassou / falta repassar.
   - Função "paroquia_repasse" (só equipe/admin): registrar o repasse,
     cancelar recebimento lançado errado, desfazer repasse.
   NÃO mexe nos acertos dos Blocos: a paróquia só registra o que recebeu.
===================================================== */
function registrarRotasParoquia(app, { supabase, exigirPagina, criarLimitador, criarPix, consultarPix }) {
  const acesso = exigirPagina("paroquia");
  const acessoRepasse = exigirPagina("paroquia_repasse");
  const limite = criarLimitador({ janelaMs: 60 * 1000, max: 60 });

  const arred = v => Math.round(Number(v || 0) * 100) / 100;
  const texto = (v, max = 300) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, max);
  const dinheiro = v => {
    const n = arred(String(v ?? 0).replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n < 10000000 ? n : NaN;
  };
  const quem = req => texto(req.nomeUsuario || req.usuarioAdmin?.email || "", 100) || null;
  const falha = (res, e, msg, status = 500) => { console.error("[PAROQUIA]", msg, e?.message || e); return res.status(status).json({ sucesso: false, erro: msg }); };
  /* mesma conta do Acertar (Blocos): bônus do bloco inteiro, comissão do plano, parceria não cobra */
  function valoresBloco(vendidas, e) {
    let cobradas = vendidas;
    if (e.tem_bonus && e.bonus_usado !== false && vendidas === e.quantidade_entregue && vendidas > 0) cobradas -= 1;
    if (!e.cobra) return { bruto: 0, comissao: 0, devido: 0 };
    const bruto = arred(cobradas * Number(e.preco));
    const comissao = arred(bruto * Number(e.comissao_pct) / 100);
    return { bruto, comissao, devido: arred(bruto - comissao) };
  }
  /* quanto a comunidade deve entregar por este bloco agora (vendas − comissão − o que o cliente já pagou no site) */
  function contaBloco(e, antes, vendidas, pagas) {
    const a = valoresBloco(antes, e), d = valoresBloco(antes + vendidas, e);
    const devido = arred(d.devido - a.devido);
    const abate = e.cobra ? arred(Math.min(pagas, vendidas) * Number(e.preco)) : 0;
    return { devido, abate, receber: arred(devido - abate) };
  }
  const CAMPOS_ENTREGA = "id, cobra, preco, comissao_pct, tem_bonus, bonus_usado, quantidade_entregue, plano_nome";
  const SEM_TABELA = "O recurso da paróquia ainda não foi ativado no banco (falta rodar o SQL 2026-11-22-paroquia).";

  /* ---------------- Pix por QR Code (confirmado pelo banco) ----------------
     Usa a mesma tabela do Acerto (blocos_acerto_pix) com origem = 'paroquia'.
     Assim, quando a equipe abrir o Acerto dessa comunidade, o Pix já aparece
     como "comprovado pelo banco" e entra no recebido. */
  async function conferirPix(linha) {
    if (linha.status === "pago") return linha;
    try {
      const pg = await consultarPix(linha.txid);
      if (pg && pg.status === "CONCLUIDA") {
        const pix0 = Array.isArray(pg.pix) && pg.pix[0] ? pg.pix[0] : {};
        const upd = { status: "pago", pago_em: pix0.horario || new Date().toISOString(), e2e_id: pix0.endToEndId || null, valor_pago: arred(pix0.valor ?? pg.valor?.original ?? linha.valor) };
        const { data } = await supabase.from("blocos_acerto_pix").update(upd).eq("id", linha.id).select("*").maybeSingle();
        return data || { ...linha, ...upd };
      }
    } catch (e) { console.error("[PAROQUIA] consultar Pix:", linha.txid, e.message); }
    return linha;
  }
  function pixPublico(l) {
    const expirado = l.status !== "pago" && Date.now() - new Date(l.created_at).getTime() > 31 * 60 * 1000;
    return { id: l.id, valor: Number(l.valor), status: expirado ? "expirado" : l.status, pago: l.status === "pago",
      pago_em: l.pago_em, valor_pago: l.valor_pago != null ? Number(l.valor_pago) : null, pix_copia_cola: l.status === "pago" ? null : l.pix_copia_cola };
  }

  app.post("/admin/paroquia/pix", limite, acesso, async (req, res) => {
    try {
      if (!criarPix || !consultarPix) return res.status(503).json({ sucesso: false, erro: "Pix indisponível neste servidor." });
      const respId = Number(req.body?.responsavel_id);
      const valor = arred(String(req.body?.valor ?? 0).replace(",", "."));
      if (!Number.isInteger(respId)) return res.status(400).json({ sucesso: false, erro: "Escolha a pessoa." });
      if (!(valor >= 1 && valor <= 50000)) return res.status(400).json({ sucesso: false, erro: "Informe um valor de Pix entre R$ 1,00 e R$ 50.000,00." });
      const { data: resp } = await supabase.from("blocos_responsaveis").select("id").eq("id", respId).maybeSingle();
      if (!resp) return res.status(404).json({ sucesso: false, erro: "Pessoa não encontrada." });
      const cobranca = await criarPix(valor, null, null, { expiracao: 1800, descricao: "FPSS 2027 - Recebimento da paroquia" });
      if (!cobranca || !cobranca.txid || !cobranca.pixCopiaECola) return res.status(502).json({ sucesso: false, erro: "Não foi possível gerar o Pix agora. Tente de novo." });
      const { data: linha, error } = await supabase.from("blocos_acerto_pix").insert({
        responsavel_id: respId, valor, txid: cobranca.txid, pix_copia_cola: cobranca.pixCopiaECola, origem: "paroquia",
        criado_por_id: req.usuarioAdmin?.id || null, criado_por_nome: quem(req)
      }).select("*").single();
      if (error) return falha(res, error, "Pix gerado, mas não foi possível registrar (rode o SQL 2026-11-22-paroquia).");
      res.json({ sucesso: true, pix: { ...pixPublico(linha), pix_copia_cola: linha.pix_copia_cola } });
    } catch (e) { return falha(res, e, "Erro ao gerar o Pix."); }
  });

  app.get("/admin/paroquia/pix/:id", limite, acesso, async (req, res) => {
    const { data: linha } = await supabase.from("blocos_acerto_pix").select("*").eq("id", Number(req.params.id)).eq("origem", "paroquia").maybeSingle();
    if (!linha) return res.status(404).json({ sucesso: false, erro: "Pix não encontrado." });
    res.json({ sucesso: true, pix: pixPublico(await conferirPix(linha)) });
  });

  /* Pix desta pessoa já gerados na paróquia e ainda não ligados a um recebimento (a tela pode ter sido fechada) */
  app.get("/admin/paroquia/responsaveis/:id/pix", limite, acesso, async (req, res) => {
    const { data, error } = await supabase.from("blocos_acerto_pix").select("*")
      .eq("responsavel_id", Number(req.params.id)).eq("origem", "paroquia").is("recebimento_id", null).is("usado_em", null).order("id");
    if (error) return res.json({ sucesso: true, pix: [] });
    const lista = [];
    for (const l of data || []) {
      const pub = pixPublico(await conferirPix(l));
      if (pub.pago || pub.status === "pendente") lista.push(pub);
    }
    res.json({ sucesso: true, pix: lista });
  });

  /* quem sou eu (a tela mostra ou esconde o que é da equipe) */
  app.get("/admin/paroquia/me", limite, acesso, (req, res) => {
    const admin = req.papelUsuario === "admin";
    res.json({ sucesso: true, nome: quem(req), admin, repasse: admin || (req.paginasUsuario || []).includes("paroquia_repasse") });
  });

  /* busca de comunidade / responsável que ainda tem bloco na rua */
  app.get("/admin/paroquia/responsaveis", limite, acesso, async (req, res) => {
    const busca = texto(req.query.busca, 60).replace(/[%,()*]/g, "");
    let q = supabase.from("blocos_resumo_responsavel").select("id, nome, comunidade, com_responsavel").gt("com_responsavel", 0);
    if (busca) q = q.or(`nome.ilike.%${busca}%,comunidade.ilike.%${busca}%`);
    const { data, error } = await q.order("comunidade").order("nome").limit(40);
    if (error) return falha(res, error, "Erro ao buscar.");
    res.json({ sucesso: true, responsaveis: data || [] });
  });

  /* blocos que a pessoa ainda tem (e os que já foram recebidos pela paróquia) */
  app.get("/admin/paroquia/responsaveis/:id/blocos", limite, acesso, async (req, res) => {
    const id = Number(req.params.id);
    const { data: resp } = await supabase.from("blocos_resumo_responsavel").select("id, nome, comunidade").eq("id", id).maybeSingle();
    if (!resp) return res.status(404).json({ sucesso: false, erro: "Pessoa não encontrada." });
    const { data: entregas, error } = await supabase.from("blocos_entregas")
      .select(CAMPOS_ENTREGA + ", blocos(sequencial, numero_inicial, numero_final)")
      .eq("responsavel_id", id).neq("status", "cancelada").eq("separada", false).order("id");
    if (error) return falha(res, error, "Erro ao carregar os blocos.");
    const ids = (entregas || []).map(e => e.id);
    let cartelas = [], recebidos = [];
    if (ids.length) {
      const r1 = await supabase.from("blocos_cartelas").select("numero, entrega_id, status").in("entrega_id", ids).in("status", ["com_responsavel", "vendida"]).limit(20000);
      cartelas = r1.data || [];
      const r2 = await supabase.from("paroquia_recebimento_blocos").select("entrega_id, recebimento_id, vendidas, devolvidas, paroquia_recebimentos(created_at)")
        .in("entrega_id", ids).eq("ativo", true);
      if (r2.error && /paroquia_/.test(r2.error.message || "")) return res.status(500).json({ sucesso: false, erro: SEM_TABELA });
      recebidos = r2.data || [];
    }
    let pagas = new Set();
    const numeros = cartelas.filter(c => c.status === "com_responsavel").map(c => c.numero);
    if (numeros.length) {
      const { data: pg } = await supabase.rpc("fpss_blocos_cartelas_pagas", { p_numeros: numeros });
      pagas = new Set((pg || []).map(p => p.numero));
    }
    const porEntrega = {};
    const vendidasAntes = {};
    cartelas.forEach(c => {
      if (c.status === "vendida") vendidasAntes[c.entrega_id] = (vendidasAntes[c.entrega_id] || 0) + 1;
      else (porEntrega[c.entrega_id] = porEntrega[c.entrega_id] || []).push(c.numero);
    });
    const jaRec = {};
    recebidos.forEach(r => { jaRec[r.entrega_id] = r; });
    const blocos = (entregas || []).map(e => {
      const nums = porEntrega[e.id] || [];
      const rec = jaRec[e.id];
      return {
        entrega_id: e.id, sequencial: e.blocos?.sequencial, numero_inicial: e.blocos?.numero_inicial, numero_final: e.blocos?.numero_final,
        quantidade: nums.length, pagas_site: nums.filter(n => pagas.has(n)).length,
        cobra: e.cobra, preco: Number(e.preco), comissao_pct: Number(e.comissao_pct), tem_bonus: e.tem_bonus, bonus_usado: e.bonus_usado,
        quantidade_entregue: e.quantidade_entregue, plano_nome: e.plano_nome, vendidas_antes: vendidasAntes[e.id] || 0,
        ja_recebido: rec ? { recebimento_id: rec.recebimento_id, vendidas: rec.vendidas, devolvidas: rec.devolvidas, em: rec.paroquia_recebimentos?.created_at || null } : null
      };
    }).filter(b => b.quantidade > 0 || b.ja_recebido);
    res.json({ sucesso: true, responsavel: resp, blocos });
  });

  /* registra o recebimento */
  app.post("/admin/paroquia/recebimentos", limite, acesso, async (req, res) => {
    const b = req.body || {};
    const respId = Number(b.responsavel_id);
    const pedidos = (Array.isArray(b.blocos) ? b.blocos : []).slice(0, 100)
      .map(x => ({ entrega_id: Number(x.entrega_id), vendidas: Number(x.vendidas) }));
    if (!Number.isInteger(respId) || !pedidos.length) return res.status(400).json({ sucesso: false, erro: "Marque pelo menos um bloco recebido." });
    if (new Set(pedidos.map(p => p.entrega_id)).size !== pedidos.length) return res.status(400).json({ sucesso: false, erro: "Bloco repetido." });
    if (pedidos.some(p => !Number.isInteger(p.entrega_id) || !Number.isInteger(p.vendidas) || p.vendidas < 0)) {
      return res.status(400).json({ sucesso: false, erro: "Informe quantas cartelas foram vendidas em cada bloco (pode ser zero)." });
    }
    const vals = { dinheiro: dinheiro(b.dinheiro), pix: 0, cartao: dinheiro(b.cartao) };
    if (Object.values(vals).some(v => Number.isNaN(v))) return res.status(400).json({ sucesso: false, erro: "Valor inválido." });
    /* Pix: só vale o que o banco confirmou, é desta pessoa, veio da paróquia e ainda não foi usado */
    const pixIds = [...new Set((Array.isArray(b.pix_ids) ? b.pix_ids : []).map(Number).filter(Number.isInteger))].slice(0, 20);
    let pixLinhas = [];
    if (pixIds.length) {
      const { data: pl } = await supabase.from("blocos_acerto_pix").select("*").in("id", pixIds);
      for (const l of pl || []) {
        if (l.origem !== "paroquia" || Number(l.responsavel_id) !== respId || l.recebimento_id || l.usado_em) return res.status(400).json({ sucesso: false, erro: "Um dos Pix não pode ser usado (já foi lançado ou é de outra pessoa). Atualize a tela." });
        const conf = await conferirPix(l);
        if (conf.status !== "pago") return res.status(400).json({ sucesso: false, erro: `O Pix de ${arred(l.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} ainda não foi confirmado pelo banco.` });
        pixLinhas.push(conf);
      }
      if (pixLinhas.length !== pixIds.length) return res.status(400).json({ sucesso: false, erro: "Pix não encontrado. Atualize a tela." });
      vals.pix = arred(pixLinhas.reduce((a, l) => a + Number(l.valor_pago ?? l.valor), 0));
    }

    const { data: resp } = await supabase.from("blocos_resumo_responsavel").select("id, nome, comunidade").eq("id", respId).maybeSingle();
    if (!resp) return res.status(404).json({ sucesso: false, erro: "Pessoa não encontrada." });
    const ids = pedidos.map(p => p.entrega_id);
    const { data: entregas } = await supabase.from("blocos_entregas")
      .select(CAMPOS_ENTREGA + ", responsavel_id, status, separada, blocos(sequencial, numero_inicial, numero_final)").in("id", ids);
    const { data: cartelas } = await supabase.from("blocos_cartelas").select("numero, entrega_id, status").in("entrega_id", ids).in("status", ["com_responsavel", "vendida"]).limit(20000);
    const nums = {}, antes = {};
    (cartelas || []).forEach(c => {
      if (c.status === "vendida") antes[c.entrega_id] = (antes[c.entrega_id] || 0) + 1;
      else (nums[c.entrega_id] = nums[c.entrega_id] || []).push(c.numero);
    });
    const todas = (cartelas || []).filter(c => c.status === "com_responsavel").map(c => c.numero);
    let pagas = new Set();
    if (todas.length) {
      const { data: pg } = await supabase.rpc("fpss_blocos_cartelas_pagas", { p_numeros: todas });
      pagas = new Set((pg || []).map(p => p.numero));
    }
    const linhas = [];
    for (const p of pedidos) {
      const e = (entregas || []).find(x => x.id === p.entrega_id);
      if (!e || e.responsavel_id !== respId || e.status === "cancelada" || e.separada) return res.status(400).json({ sucesso: false, erro: "Algum bloco não pertence a esta pessoa. Atualize a tela." });
      const lista = nums[e.id] || [];
      if (!lista.length) return res.status(400).json({ sucesso: false, erro: `O bloco ${e.blocos?.sequencial ?? ""} não tem mais cartelas pendentes (a equipe já acertou). Atualize a tela.` });
      if (p.vendidas > lista.length) return res.status(400).json({ sucesso: false, erro: `O bloco ${e.blocos?.sequencial ?? ""} tem só ${lista.length} cartela(s); você informou ${p.vendidas} vendidas.` });
      const pg = lista.filter(n => pagas.has(n)).length;
      const conta = contaBloco(e, antes[e.id] || 0, p.vendidas, pg);
      linhas.push({
        devido: conta.devido, abate_site: conta.abate,
        entrega_id: e.id, sequencial: e.blocos?.sequencial ?? null, numero_inicial: e.blocos?.numero_inicial ?? null, numero_final: e.blocos?.numero_final ?? null,
        quantidade: lista.length, vendidas: p.vendidas, devolvidas: lista.length - p.vendidas, pagas_site: pg
      });
    }
    const { data: rec, error: er } = await supabase.from("paroquia_recebimentos").insert({
      responsavel_id: respId, responsavel_nome: resp.nome, comunidade: resp.comunidade || null,
      ...vals, a_receber: arred(linhas.reduce((a, l) => a + l.devido - l.abate_site, 0)),
      observacao: texto(b.observacao) || null, lancador_id: req.usuarioAdmin?.id || null, lancador_nome: quem(req)
    }).select("id, created_at").single();
    if (er) return falha(res, er, /paroquia_/.test(er.message || "") ? SEM_TABELA : "Erro ao registrar o recebimento.");
    const { error: eb } = await supabase.from("paroquia_recebimento_blocos").insert(linhas.map(l => ({ ...l, recebimento_id: rec.id })));
    if (!eb && pixLinhas.length) {
      const { data: lig } = await supabase.from("blocos_acerto_pix").update({ recebimento_id: rec.id }).in("id", pixLinhas.map(l => l.id)).is("recebimento_id", null).select("id");
      if ((lig || []).length !== pixLinhas.length) {
        if (lig?.length) await supabase.from("blocos_acerto_pix").update({ recebimento_id: null }).in("id", lig.map(x => x.id));
        await supabase.from("paroquia_recebimentos").delete().eq("id", rec.id);
        return res.status(409).json({ sucesso: false, erro: "Esse Pix foi usado ao mesmo tempo em outro lançamento. Atualize a tela." });
      }
    }
    if (eb) {
      await supabase.from("paroquia_recebimentos").delete().eq("id", rec.id);
      if (eb.code === "23505") return res.status(409).json({ sucesso: false, erro: "Algum desses blocos já foi recebido por outra pessoa. Atualize a tela." });
      return falha(res, eb, "Erro ao registrar os blocos.");
    }
    res.json({ sucesso: true, id: rec.id, blocos: linhas.length });
  });

  /* tudo que a tela precisa: recebimentos (com blocos) e repasses */
  app.get("/admin/paroquia/dados", limite, acesso, async (req, res) => {
    const { data: recs, error } = await supabase.from("paroquia_recebimentos")
      .select("*, paroquia_recebimento_blocos(entrega_id, sequencial, numero_inicial, numero_final, quantidade, vendidas, devolvidas, pagas_site, devido, abate_site, ativo)")
      .eq("cancelado", false).order("created_at", { ascending: false }).limit(3000);
    if (error) return falha(res, error, /paroquia_/.test(error.message || "") ? SEM_TABELA : "Erro ao carregar.");
    const { data: reps } = await supabase.from("paroquia_repasses").select("*").eq("cancelado", false).order("data_repasse", { ascending: false }).order("id", { ascending: false }).limit(1000);
    res.json({ sucesso: true, recebimentos: recs || [], repasses: reps || [] });
  });

  /* ---------------- só equipe (função paroquia_repasse) ---------------- */
  app.post("/admin/paroquia/recebimentos/:id/cancelar", limite, acessoRepasse, async (req, res) => {
    const id = Number(req.params.id);
    const { data: r } = await supabase.from("paroquia_recebimentos").select("id, repasse_id, cancelado").eq("id", id).maybeSingle();
    if (!r || r.cancelado) return res.status(404).json({ sucesso: false, erro: "Recebimento não encontrado." });
    if (r.repasse_id) return res.status(400).json({ sucesso: false, erro: "Esse recebimento já foi repassado. Desfaça o repasse antes." });
    const { data: usados } = await supabase.from("blocos_acerto_pix").select("id").eq("recebimento_id", id).not("usado_em", "is", null).limit(1);
    if ((usados || []).length) return res.status(400).json({ sucesso: false, erro: "O Pix desse recebimento já foi lançado em um acerto dos Blocos. Desfaça o acerto antes." });
    await supabase.from("blocos_acerto_pix").update({ recebimento_id: null }).eq("recebimento_id", id);
    const { error } = await supabase.from("paroquia_recebimentos").update({ cancelado: true, cancelado_por: quem(req), cancelado_em: new Date().toISOString() }).eq("id", id);
    if (error) return falha(res, error, "Erro ao cancelar.");
    await supabase.from("paroquia_recebimento_blocos").update({ ativo: false }).eq("recebimento_id", id);
    res.json({ sucesso: true });
  });

  app.post("/admin/paroquia/repasses", limite, acessoRepasse, async (req, res) => {
    const b = req.body || {};
    const ids = [...new Set((Array.isArray(b.recebimento_ids) ? b.recebimento_ids : []).map(Number).filter(Number.isInteger))].slice(0, 500);
    if (!ids.length) return res.status(400).json({ sucesso: false, erro: "Marque o que a paróquia está repassando." });
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(b.data || ""));
    const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Porto_Velho" });
    if (!m || String(b.data) > hoje || m[1] < "2026") return res.status(400).json({ sucesso: false, erro: "Data inválida (não pode ser futura)." });
    /* o Pix confirmado pelo banco cai direto na conta da festa: não entra no repasse */
    const vals = { dinheiro: dinheiro(b.dinheiro), pix: 0, cartao: dinheiro(b.cartao) };
    if (Object.values(vals).some(v => Number.isNaN(v))) return res.status(400).json({ sucesso: false, erro: "Valor inválido." });
    const { data: recs } = await supabase.from("paroquia_recebimentos")
      .select("id, dinheiro, pix, cartao, repasse_id, cancelado, paroquia_recebimento_blocos(ativo)").in("id", ids);
    if (!recs || recs.length !== ids.length || recs.some(r => r.cancelado || r.repasse_id)) {
      return res.status(409).json({ sucesso: false, erro: "Algum recebimento já foi repassado ou cancelado. Atualize a tela." });
    }
    const soma = k => arred(recs.reduce((a, r) => a + Number(r[k] || 0), 0));
    const nBlocos = recs.reduce((a, r) => a + (r.paroquia_recebimento_blocos || []).filter(x => x.ativo).length, 0);
    const { data: rep, error } = await supabase.from("paroquia_repasses").insert({
      data_repasse: b.data, esperado_dinheiro: soma("dinheiro"), esperado_pix: 0, esperado_cartao: soma("cartao"),
      ...vals, blocos: nBlocos, observacao: texto(b.observacao) || null, lancador_id: req.usuarioAdmin?.id || null, lancador_nome: quem(req)
    }).select("id").single();
    if (error) return falha(res, error, /paroquia_/.test(error.message || "") ? SEM_TABELA : "Erro ao registrar o repasse.");
    const { data: marcados, error: eu } = await supabase.from("paroquia_recebimentos").update({ repasse_id: rep.id }).in("id", ids).is("repasse_id", null).select("id");
    if (eu || (marcados || []).length !== ids.length) {
      if (marcados?.length) await supabase.from("paroquia_recebimentos").update({ repasse_id: null }).in("id", marcados.map(x => x.id));
      await supabase.from("paroquia_repasses").delete().eq("id", rep.id);
      return res.status(409).json({ sucesso: false, erro: "Não foi possível fechar o repasse (alguém mexeu ao mesmo tempo). Atualize a tela." });
    }
    res.json({ sucesso: true, id: rep.id });
  });

  app.post("/admin/paroquia/repasses/:id/desfazer", limite, acessoRepasse, async (req, res) => {
    const id = Number(req.params.id);
    const { data: r } = await supabase.from("paroquia_repasses").select("id, cancelado").eq("id", id).maybeSingle();
    if (!r || r.cancelado) return res.status(404).json({ sucesso: false, erro: "Repasse não encontrado." });
    await supabase.from("paroquia_recebimentos").update({ repasse_id: null }).eq("repasse_id", id);
    const { error } = await supabase.from("paroquia_repasses").update({ cancelado: true, cancelado_por: quem(req), cancelado_em: new Date().toISOString() }).eq("id", id);
    if (error) return falha(res, error, "Erro ao desfazer o repasse.");
    res.json({ sucesso: true });
  });
}

module.exports = { registrarRotasParoquia };

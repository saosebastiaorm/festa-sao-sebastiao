/* =====================================================================
   FPSS 2027 — DISTRIBUIÇÃO DE BLOCOS DE CARTELAS FÍSICAS
   ARQUIVO: src/blocos/blocos.js   (2026-10-05)

   Controle dos blocos entregues aos distribuidores (comunidades,
   ambulantes, voluntários, parceiros) e da prestação de contas,
   que pode ser feita em partes até o último minuto da festa.

   Quem pode usar: administradores e usuários com "acesso_blocos"
   (tela Usuários). Cada lançamento grava o LANÇADOR (quem estava
   logado), que é o responsável pela informação.

   As operações que mexem em cartelas (cadastrar faixa, entregar,
   acertar, desfazer, cancelar) rodam em funções do banco
   (database/2026-10-05-distribuicao-blocos.sql) — atômicas, então
   dois lançadores ao mesmo tempo nunca entregam a mesma cartela.
===================================================================== */

const ERROS = {
  FAIXA_INVALIDA: "Faixa inválida. Confira o número inicial, o final e o tamanho do bloco.",
  FAIXA_GRANDE_DEMAIS: "Faixa grande demais de uma vez (máximo 60 mil cartelas).",
  FAIXA_JA_CADASTRADA: "Essa faixa já tem cartela cadastrada (a partir da cartela {x}).",
  BLOCOS_COM_MOVIMENTO: "Não dá para excluir: algum desses blocos já foi entregue.",
  PLANO_INVALIDO: "Escolha o plano.",
  SEM_BLOCOS: "Escolha pelo menos um bloco.",
  RESPONSAVEL_INVALIDO: "Responsável não encontrado.",
  RESPONSAVEL_SEM_NOME: "Informe o nome de quem está recebendo.",
  BLOCO_INVALIDO: "Bloco não encontrado.",
  BLOCO_SEM_CARTELAS: "O bloco {x} ficou sem nenhuma cartela marcada.",
  CARTELA_INDISPONIVEL: "A cartela {x} não está disponível (já está com alguém). Atualize e confira.",
  ENTREGA_INVALIDA: "Entrega não encontrada para esse responsável.",
  ENTREGA_COM_ACERTO: "Essa entrega já teve acerto. Desfaça o acerto antes de cancelar.",
  SITUACAO_INVALIDA: "Situação de cartela inválida.",
  CARTELA_JA_ACERTADA: "A cartela {x} já foi acertada por outro lançamento. Atualize a tela.",
  ACERTO_VAZIO: "Nada para acertar: marque cartelas ou informe um valor pago.",
  VALOR_INVALIDO: "Valor pago inválido.",
  ACERTO_INVALIDO: "Acerto não encontrado ou já desfeito.",
  ACERTO_POSTERIOR: "Esse bloco teve outro acerto depois deste. Desfaça primeiro o mais recente.",
  CARTELA_ALTERADA: "A cartela {x} mudou depois desse acerto; não dá para desfazer automaticamente.",
  COMUNIDADE_INVALIDA: "Comunidade não encontrada na lista.",
  DISTRIBUIDOR_INVALIDO: "Escolha quem da equipe entregou os blocos (distribuidor).",
  SEPARAR_SEM_COMUNIDADE: "Para separar blocos sem o nome de quem vai receber, escolha a comunidade (ou digite o parceiro).",
  ENTREGA_SEPARADA: "Esse bloco ainda está só separado (não foi entregue). Confirme a entrega antes de acertar.",
  ENTREGA_NAO_SEPARADA: "Algum desses blocos não está mais separado. Atualize a tela."
};

function traduzirErro(error) {
  const msg = String(error?.message || error || "");
  const m = msg.match(/([A-Z_]{6,})(?::(\S+))?/);
  if (m && ERROS[m[1]]) return ERROS[m[1]].replace("{x}", m[2] || "");
  return null;
}

const arred = v => Math.round(Number(v || 0) * 100) / 100;
const texto = (v, max = 200) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, max);
const soDigitos = v => String(v ?? "").replace(/\D/g, "");
/* número da cartela como foi digitado → id (sem o dígito verificador):
   "24194-68" → 24194 · "2419468" → 24194 · "6793" → 6793 */
function idCartela(v) {
  const bruto = String(v ?? "").trim().replace(/\s/g, "");
  const m = /^(\d+)-(\d{1,2})$/.exec(bruto);
  if (m) return parseInt(m[1], 10);
  if (/^\d+$/.test(bruto)) return parseInt(bruto.length > 5 ? bruto.slice(0, -2) : bruto, 10);
  return NaN;
}

function registrarRotasBlocos(app, { supabase, limitadorOperador, paginasDoUsuario, PAPEIS_VALIDOS }) {

  const papeisValidos = PAPEIS_VALIDOS || ["admin", "padrao", "voluntario"];

  /* ------------------------- AUTENTICAÇÃO -------------------------- */
  async function exigirAcessoBlocos(req, res, next) {
    try {
      const token = String(req.headers.authorization || "").replace("Bearer ", "").trim();
      if (!token) return res.status(401).json({ sucesso: false, erro: "Sessão não encontrada. Faça login novamente." });
      const { data: u, error: eu } = await supabase.auth.getUser(token);
      if (eu || !u?.user) return res.status(401).json({ sucesso: false, erro: "Sessão inválida ou expirada. Faça login novamente." });
      const { data: perfil } = await supabase
        .from("user_profiles").select("*").eq("id", u.user.id).maybeSingle();
      if (!perfil || !papeisValidos.includes(perfil.role)) {
        return res.status(403).json({ sucesso: false, erro: "Acesso restrito." });
      }
      const admin = perfil.role === "admin";
      if (!admin) {
        /* Blocos liberado pelo perfil (Usuários → Perfis de acesso) ou
           individualmente (acesso_blocos). A consulta de uma cartela
           também serve à tela Cartelas (Conferência rápida). */
        const liberadas = paginasDoUsuario ? await paginasDoUsuario(perfil) : (perfil.acesso_blocos === true ? ["blocos"] : []);
        const consultaCartela = req.method === "GET" && req.path.startsWith("/admin/blocos/cartela/");
        if (!liberadas.includes("blocos") && !(consultaCartela && liberadas.includes("cartelas"))) {
          return res.status(403).json({ sucesso: false, erro: "Seu usuário não tem acesso à Distribuição de Blocos. Peça a um administrador para liberar na tela Usuários." });
        }
      }
      req.lancador = { id: u.user.id, nome: perfil.nome || u.user.email, admin };
      next();
    } catch (e) {
      console.error("[BLOCOS] erro ao verificar acesso:", e);
      return res.status(500).json({ sucesso: false, erro: "Erro interno ao verificar permissão." });
    }
  }

  function somenteAdmin(req, res, next) {
    if (!req.lancador?.admin) return res.status(403).json({ sucesso: false, erro: "Só administradores podem fazer isso." });
    next();
  }

  const base = [limitadorOperador, exigirAcessoBlocos].filter(Boolean);

  function falha(res, error, padrao, status = 400) {
    const traduzido = traduzirErro(error);
    if (!traduzido) console.error("[BLOCOS]", padrao, error);
    return res.status(traduzido ? status : 500).json({ sucesso: false, erro: traduzido || padrao });
  }

  async function historico(acao, descricao, dados, lancador) {
    await supabase.from("blocos_historico").insert({
      acao, descricao, dados, lancador_id: lancador.id, lancador_nome: lancador.nome
    });
  }

  /* --------------------------- QUEM SOU ---------------------------- */
  app.get("/admin/blocos/me", ...base, (req, res) => {
    res.json({ sucesso: true, nome: req.lancador.nome, admin: req.lancador.admin });
  });

  /* ------------------------ CONFIG E PLANOS ------------------------ */
  app.get("/admin/blocos/config", ...base, async (req, res) => {
    const [{ data: config }, { data: planos }] = await Promise.all([
      supabase.from("blocos_config").select("*").eq("id", 1).maybeSingle(),
      supabase.from("blocos_planos").select("*").order("ordem").order("id")
    ]);
    res.json({ sucesso: true, config, planos: planos || [] });
  });

  app.put("/admin/blocos/config", ...base, somenteAdmin, async (req, res) => {
    const b = req.body || {};
    const dados = {};
    if (b.preco_cartela !== undefined) {
      const v = arred(String(b.preco_cartela).replace(",", "."));
      if (!(v > 0)) return res.status(400).json({ sucesso: false, erro: "Preço inválido." });
      dados.preco_cartela = v;
    }
    if (b.tamanho_com_bonus !== undefined) {
      const t = parseInt(b.tamanho_com_bonus, 10);
      if (!(t >= 1)) return res.status(400).json({ sucesso: false, erro: "Tamanho inválido." });
      dados.tamanho_com_bonus = t;
    }
    if (b.meta_devolucao !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.meta_devolucao))) return res.status(400).json({ sucesso: false, erro: "Data da meta inválida." });
      dados.meta_devolucao = b.meta_devolucao;
    }
    if (b.digitos !== undefined) {
      const d = parseInt(b.digitos, 10);
      if (!(d >= 1 && d <= 8)) return res.status(400).json({ sucesso: false, erro: "Quantidade de dígitos inválida." });
      dados.digitos = d;
    }
    dados.atualizado_em = new Date().toISOString();
    const { error } = await supabase.from("blocos_config").update(dados).eq("id", 1);
    if (error) return falha(res, error, "Erro ao salvar configuração.");
    await historico("config", "Alterou a configuração dos blocos", dados, req.lancador);
    res.json({ sucesso: true });
  });

  function lerPlano(b) {
    const nome = texto(b.nome, 60);
    const comissao = arred(String(b.comissao_pct ?? 0).replace(",", "."));
    if (!nome) return { erro: "Informe o nome do plano." };
    if (comissao < 0 || comissao > 100) return { erro: "Comissão deve ser de 0 a 100%." };
    const dados = { nome, comissao_pct: comissao, cobra: b.cobra !== false, ativo: b.ativo !== false, descricao: texto(b.descricao, 200) || null };
    // envia as 2 cartas da visita? (coluna criada no SQL 2026-10-09-plano-envia-carta.sql)
    if (b.envia_carta !== undefined) dados.envia_carta = b.envia_carta === true;
    return { dados };
  }

  app.post("/admin/blocos/planos", ...base, somenteAdmin, async (req, res) => {
    const p = lerPlano(req.body || {});
    if (p.erro) return res.status(400).json({ sucesso: false, erro: p.erro });
    const { data: ult } = await supabase.from("blocos_planos").select("ordem").order("ordem", { ascending: false }).limit(1);
    p.dados.ordem = (ult?.[0]?.ordem || 0) + 1;
    const { error } = await supabase.from("blocos_planos").insert(p.dados);
    if (error) return falha(res, error, error.code === "23505" ? "Já existe um plano com esse nome." : "Erro ao criar plano.");
    await historico("plano", `Criou o plano ${p.dados.nome} (${p.dados.comissao_pct}%)`, p.dados, req.lancador);
    res.json({ sucesso: true });
  });

  app.put("/admin/blocos/planos/:id", ...base, somenteAdmin, async (req, res) => {
    const p = lerPlano(req.body || {});
    if (p.erro) return res.status(400).json({ sucesso: false, erro: p.erro });
    const { error } = await supabase.from("blocos_planos").update(p.dados).eq("id", Number(req.params.id));
    if (error) return falha(res, error, "Erro ao salvar plano.");
    await historico("plano", `Alterou o plano ${p.dados.nome} (${p.dados.comissao_pct}%${p.dados.ativo ? "" : ", desativado"}) — vale para as próximas entregas`, p.dados, req.lancador);
    res.json({ sucesso: true });
  });

  /* ---------------------- CADASTRO DE BLOCOS ----------------------- */
  app.post("/admin/blocos/faixa", ...base, somenteAdmin, async (req, res) => {
    const b = req.body || {};
    const { data, error } = await supabase.rpc("fpss_blocos_cadastrar_faixa", {
      p_inicio: idCartela(b.inicio),
      p_fim: idCartela(b.fim),
      p_tamanho: parseInt(b.tamanho, 10),
      p_lancador_id: req.lancador.id,
      p_lancador_nome: req.lancador.nome
    });
    if (error) return falha(res, error, "Erro ao cadastrar blocos.");
    res.json({ sucesso: true, ...data });
  });

  app.post("/admin/blocos/faixa/excluir", ...base, somenteAdmin, async (req, res) => {
    const b = req.body || {};
    const { data, error } = await supabase.rpc("fpss_blocos_excluir_faixa", {
      p_seq_inicio: parseInt(b.seq_inicio, 10),
      p_seq_fim: parseInt(b.seq_fim, 10),
      p_lancador_id: req.lancador.id,
      p_lancador_nome: req.lancador.nome
    });
    if (error) return falha(res, error, "Erro ao excluir blocos.");
    res.json({ sucesso: true, ...data });
  });

  // catálogo: blocos por faixa de sequencial (tela Blocos e formulário de visita)
  app.get("/admin/blocos/catalogo", ...base, async (req, res) => {
    const de = Math.max(1, parseInt(req.query.de, 10) || 1);
    const qtd = Math.min(500, Math.max(1, parseInt(req.query.quantidade, 10) || 100));
    // ordenação por coluna (clique no título da coluna) + páginas
    const COLUNAS = ["sequencial", "numero_inicial", "numero_final", "quantidade", "estoque", "com_responsavel", "vendidas", "devolvidas", "responsaveis"];
    const ordem = COLUNAS.includes(req.query.ordem) ? req.query.ordem : "sequencial";
    const asc = req.query.dir !== "desc";
    const pagina = Math.max(0, parseInt(req.query.pagina, 10) || 0);
    let q = supabase.from("blocos_resumo_bloco").select("*", { count: "exact" }).gte("sequencial", de)
      .order(ordem, { ascending: asc, nullsFirst: false });
    if (ordem !== "sequencial") q = q.order("sequencial", { ascending: true });
    // livre = nenhuma cartela com distribuidor nem vendida (estoque + devolvidas = todas)
    if (req.query.livres === "1") q = q.eq("com_responsavel", 0).eq("vendidas", 0);
    if (req.query.tamanho) q = q.eq("quantidade", parseInt(req.query.tamanho, 10));
    q = q.range(pagina * qtd, pagina * qtd + qtd - 1);
    const { data, error, count: totalFiltro } = await q;
    if (error) return falha(res, error, "Erro ao carregar blocos.");
    const { count } = await supabase.from("blocos").select("id", { count: "exact", head: true });
    res.json({ sucesso: true, blocos: data || [], total_blocos: count || 0, total_filtro: totalFiltro || 0, pagina, por_pagina: qtd });
  });

  // um bloco com todas as cartelas (pela cartela ou pelo sequencial)
  app.get("/admin/blocos/bloco", ...base, async (req, res) => {
    let bloco = null;
    if (req.query.sequencial) {
      const { data } = await supabase.from("blocos").select("*").eq("sequencial", parseInt(soDigitos(req.query.sequencial), 10)).maybeSingle();
      bloco = data;
    } else if (req.query.cartela) {
      const n = idCartela(req.query.cartela);
      if (Number.isFinite(n)) {
        const { data: c } = await supabase.from("blocos_cartelas").select("bloco_id").eq("numero", n).maybeSingle();
        if (c) {
          const { data } = await supabase.from("blocos").select("*").eq("id", c.bloco_id).maybeSingle();
          bloco = data;
        }
      }
    }
    if (!bloco) return res.status(404).json({ sucesso: false, erro: "Bloco não encontrado. Confira o número (o bloco precisa estar cadastrado em Blocos)." });

    const { data: cartelas } = await supabase.from("blocos_cartelas")
      .select("numero, status, entrega_id").eq("bloco_id", bloco.id).order("numero");
    const entregaIds = [...new Set((cartelas || []).map(c => c.entrega_id).filter(Boolean))];
    let entregas = [];
    if (entregaIds.length) {
      const { data } = await supabase.from("blocos_entregas")
        .select("id, responsavel_id, plano_nome, created_at, lancador_nome, status, blocos_responsaveis(nome, comunidade)")
        .in("id", entregaIds);
      entregas = data || [];
    }
    const porEntrega = Object.fromEntries(entregas.map(e => [e.id, e]));
    res.json({
      sucesso: true,
      bloco,
      cartelas: (cartelas || []).map(c => {
        const e = c.entrega_id ? porEntrega[c.entrega_id] : null;
        return {
          numero: c.numero, status: c.status,
          responsavel: e ? (e.blocos_responsaveis?.nome || "") : null,
          responsavel_id: e ? e.responsavel_id : null
        };
      })
    });
  });

  /* ------------------------- RESPONSÁVEIS -------------------------- */
  /* Blocos SEPARADOS (ainda não entregues), agrupados por quem vai receber.
     Usado pela aba "Separadas" para achar e confirmar a entrega na visita. */
  app.get("/admin/blocos/separadas", ...base, async (req, res) => {
    const busca = texto(req.query.busca, 60).toLowerCase();
    const { data, error } = await supabase
      .from("blocos_entregas")
      .select("id, created_at, lancador_nome, distribuidor_nome, plano_nome, quantidade_entregue, responsavel_id, blocos(sequencial, numero_inicial, numero_final), blocos_responsaveis(id, nome, comunidade, comunidade_id, telefone, provisorio)")
      .eq("separada", true)
      .eq("status", "ativa")
      .order("created_at", { ascending: true })
      .limit(5000);
    if (error) return falha(res, error, "Erro ao carregar os blocos separados.");

    const grupos = new Map();
    (data || []).forEach(e => {
      const r = e.blocos_responsaveis || {};
      const id = e.responsavel_id;
      if (!grupos.has(id)) {
        grupos.set(id, {
          responsavel_id: id,
          nome: r.nome || "",
          comunidade: r.comunidade || "",
          comunidade_id: r.comunidade_id || null,
          telefone: r.telefone || "",
          provisorio: r.provisorio === true,
          blocos: 0, cartelas: 0,
          separado_em: e.created_at, ultimo_em: e.created_at,
          lancadores: new Set(), planos: new Set(),
          faixas: []
        });
      }
      const g = grupos.get(id);
      g.blocos += 1;
      g.cartelas += Number(e.quantidade_entregue || 0);
      if (e.created_at < g.separado_em) g.separado_em = e.created_at;
      if (e.created_at > g.ultimo_em) g.ultimo_em = e.created_at;
      if (e.lancador_nome) g.lancadores.add(e.lancador_nome);
      if (e.plano_nome) g.planos.add(e.plano_nome);
      g.faixas.push({
        entrega_id: e.id,
        sequencial: e.blocos?.sequencial ?? null,
        numero_inicial: e.blocos?.numero_inicial ?? null,
        numero_final: e.blocos?.numero_final ?? null,
        quantidade: e.quantidade_entregue
      });
    });

    let lista = [...grupos.values()].map(g => ({
      ...g,
      lancadores: [...g.lancadores],
      planos: [...g.planos],
      faixas: g.faixas.sort((a, b) => (a.numero_inicial || 0) - (b.numero_inicial || 0))
    }));
    if (busca) {
      const dig = soDigitos(busca);
      const nCartela = /\d/.test(busca) ? idCartela(busca) : NaN;
      lista = lista.filter(g =>
        g.nome.toLowerCase().includes(busca) ||
        g.comunidade.toLowerCase().includes(busca) ||
        (dig && String(g.telefone || "").includes(dig)) ||
        (dig && g.faixas.some(f => String(f.sequencial) === dig ||
          (Number.isFinite(nCartela) && nCartela >= f.numero_inicial && nCartela <= f.numero_final)))
      );
    }
    lista.sort((a, b) => (a.comunidade || a.nome).localeCompare(b.comunidade || b.nome, "pt-BR"));
    res.json({
      sucesso: true,
      grupos: lista,
      totais: {
        grupos: lista.length,
        blocos: lista.reduce((s, g) => s + g.blocos, 0),
        cartelas: lista.reduce((s, g) => s + g.cartelas, 0)
      }
    });
  });

  app.get("/admin/blocos/responsaveis", ...base, async (req, res) => {
    const busca = texto(req.query.busca, 60).replace(/[%,()*]/g, "");
    let q = supabase.from("blocos_resumo_responsavel").select("*");
    if (busca) q = q.or(`nome.ilike.%${busca}%,comunidade.ilike.%${busca}%,telefone.ilike.%${soDigitos(busca) || busca}%`);
    if (req.query.pendentes === "1") q = q.or("com_responsavel.gt.0,saldo.gt.0");
    q = q.order("nome").limit(Math.min(300, parseInt(req.query.limite, 10) || 60));
    const { data, error } = await q;
    if (error) return falha(res, error, "Erro ao carregar responsáveis.");
    res.json({ sucesso: true, responsaveis: data || [] });
  });

  app.put("/admin/blocos/responsaveis/:id", ...base, async (req, res) => {
    const b = req.body || {};
    const nome = texto(b.nome, 100);
    if (!nome) return res.status(400).json({ sucesso: false, erro: "Informe o nome." });
    let comunidadeTxt = texto(b.comunidade, 100) || null;
    const comunidadeId = Number(b.comunidade_id) || null;
    if (comunidadeId) {
      const { data: com } = await supabase.from("blocos_comunidades").select("nome, local").eq("id", comunidadeId).maybeSingle();
      if (!com) return res.status(400).json({ sucesso: false, erro: "Comunidade não encontrada na lista." });
      comunidadeTxt = com.nome + (com.local ? " - " + com.local : "");
    }
    const dados = {
      nome,
      comunidade_id: comunidadeId,
      comunidade: comunidadeTxt,
      telefone: soDigitos(b.telefone).slice(0, 13) || null,
      endereco: texto(b.endereco, 200) || null,
      observacao: texto(b.observacao, 300) || null
    };
    const id = Number(req.params.id);
    const { data: antes } = await supabase.from("blocos_responsaveis").select("*").eq("id", id).maybeSingle();
    if (!antes) return res.status(404).json({ sucesso: false, erro: "Responsável não encontrado." });
    const { error } = await supabase.from("blocos_responsaveis").update(dados).eq("id", id);
    if (error) return falha(res, error, "Erro ao salvar.");
    await historico("editar_responsavel", `Editou os dados de ${antes.nome}`, { id, antes, depois: dados }, req.lancador);
    res.json({ sucesso: true });
  });

  // definir/corrigir o distribuidor (quem entregou) das entregas deste responsável
  app.put("/admin/blocos/responsaveis/:id/distribuidor", ...base, async (req, res) => {
    const id = Number(req.params.id);
    const todas = req.body?.todas === true;
    const { data: dist } = await supabase.from("blocos_distribuidores").select("id, nome").eq("id", Number(req.body?.distribuidor_id)).maybeSingle();
    if (!dist) return res.status(400).json({ sucesso: false, erro: "Escolha o distribuidor na lista." });
    const { data: resp } = await supabase.from("blocos_responsaveis").select("nome").eq("id", id).maybeSingle();
    if (!resp) return res.status(404).json({ sucesso: false, erro: "Responsável não encontrado." });
    let q = supabase.from("blocos_entregas").update({ distribuidor_id: dist.id, distribuidor_nome: dist.nome })
      .eq("responsavel_id", id).neq("status", "cancelada");
    if (!todas) q = q.is("distribuidor_id", null);
    const { data: alteradas, error } = await q.select("id, recibo_id");
    if (error) return falha(res, error, "Erro ao salvar o distribuidor.");
    const recibos = [...new Set((alteradas || []).map(e => e.recibo_id).filter(Boolean))];
    if (recibos.length) await supabase.from("blocos_recibos").update({ distribuidor_id: dist.id, distribuidor_nome: dist.nome }).in("id", recibos);
    await historico("editar_distribuidor", `Definiu ${dist.nome} como distribuidor de ${(alteradas || []).length} entrega(s) de ${resp.nome}${todas ? " (todas)" : " (as que estavam sem distribuidor)"}`,
      { responsavel_id: id, distribuidor_id: dist.id, todas, entregas: (alteradas || []).map(e => e.id) }, req.lancador);
    res.json({ sucesso: true, alteradas: (alteradas || []).length });
  });

  // ficha completa: entregas, cartelas, acertos
  app.get("/admin/blocos/responsaveis/:id", ...base, async (req, res) => {
    const id = Number(req.params.id);
    const { data: resumo } = await supabase.from("blocos_resumo_responsavel").select("*").eq("id", id).maybeSingle();
    if (!resumo) return res.status(404).json({ sucesso: false, erro: "Responsável não encontrado." });

    const [{ data: dadosResp }, { data: entregas }, { data: acertos }] = await Promise.all([
      supabase.from("blocos_responsaveis").select("observacao").eq("id", id).maybeSingle(),
      supabase.from("blocos_entregas")
        .select("*, blocos(sequencial, numero_inicial, numero_final, quantidade)")
        .eq("responsavel_id", id).neq("status", "cancelada").order("id"),
      supabase.from("blocos_acertos").select("*, blocos_acerto_itens(*)")
        .eq("responsavel_id", id).order("created_at", { ascending: false })
    ]);

    const ids = (entregas || []).map(e => e.id);
    let cartelas = [];
    if (ids.length) {
      const { data } = await supabase.from("blocos_cartelas").select("numero, status, entrega_id").in("entrega_id", ids).order("numero").limit(20000);
      cartelas = data || [];
    }
    const porEntrega = {};
    cartelas.forEach(c => { (porEntrega[c.entrega_id] = porEntrega[c.entrega_id] || []).push({ numero: c.numero, status: c.status }); });

    // valor devido acumulado de cada entrega (soma dos itens de acertos válidos)
    const devidoPorEntrega = {};
    (acertos || []).filter(a => !a.desfeito).forEach(a => (a.blocos_acerto_itens || []).forEach(i => {
      devidoPorEntrega[i.entrega_id] = arred((devidoPorEntrega[i.entrega_id] || 0) + Number(i.valor_devido || 0));
    }));

    res.json({
      sucesso: true,
      responsavel: { ...resumo, observacao: dadosResp?.observacao || null },
      entregas: (entregas || []).map(e => ({
        id: e.id, bloco_id: e.bloco_id, recibo_id: e.recibo_id,
        sequencial: e.blocos?.sequencial, numero_inicial: e.blocos?.numero_inicial,
        numero_final: e.blocos?.numero_final, quantidade_bloco: e.blocos?.quantidade,
        plano_nome: e.plano_nome, comissao_pct: Number(e.comissao_pct), cobra: e.cobra, preco: Number(e.preco),
        quantidade_entregue: e.quantidade_entregue, tem_bonus: e.tem_bonus, bonus_usado: e.bonus_usado,
        status: e.status, lancador_nome: e.lancador_nome, distribuidor_nome: e.distribuidor_nome || null, created_at: e.created_at,
        separada: e.separada === true, entregue_em: e.entregue_em || null,
        valor_devido: devidoPorEntrega[e.id] || 0,
        cartelas: porEntrega[e.id] || []
      })),
      acertos: (acertos || []).map(a => ({
        id: a.id, created_at: a.created_at, lancador_nome: a.lancador_nome,
        vendidas: a.vendidas, devolvidas: a.devolvidas,
        valor_bruto: Number(a.valor_bruto), valor_comissao: Number(a.valor_comissao),
        valor_devido: Number(a.valor_devido), valor_pago: Number(a.valor_pago),
        observacao: a.observacao, desfeito: a.desfeito, desfeito_por_nome: a.desfeito_por_nome, desfeito_em: a.desfeito_em,
        itens: (a.blocos_acerto_itens || []).map(i => ({
          entrega_id: i.entrega_id, vendidas: i.vendidas, devolvidas: i.devolvidas,
          valor_devido: Number(i.valor_devido), cartelas: i.cartelas
        }))
      }))
    });
  });

  app.get("/admin/blocos/recibos/:id", ...base, async (req, res) => {
    const { data } = await supabase.from("blocos_recibos")
      .select("*, blocos_responsaveis(nome, comunidade, telefone, endereco)")
      .eq("id", Number(req.params.id)).maybeSingle();
    if (!data) return res.status(404).json({ sucesso: false, erro: "Recibo não encontrado." });
    const { data: entregas } = await supabase.from("blocos_entregas")
      .select("id, plano_nome, quantidade_entregue, status, blocos(sequencial, numero_inicial, numero_final)")
      .eq("recibo_id", data.id).order("id");
    res.json({ sucesso: true, recibo: data, entregas: entregas || [] });
  });

  /* ---------------------------- ENTREGA ---------------------------- */
  app.post("/admin/blocos/entregar", ...base, async (req, res) => {
    const b = req.body || {};
    const r = b.responsavel || {};
    const comunidadeId = Number(r.comunidade_id) || null;
    const responsavel = r.id
      ? { id: Number(r.id), comunidade_id: comunidadeId, comunidade: texto(r.comunidade, 100), telefone: soDigitos(r.telefone).slice(0, 13), endereco: texto(r.endereco, 200) }
      : { nome: texto(r.nome, 100), comunidade_id: comunidadeId, comunidade: texto(r.comunidade, 100), telefone: soDigitos(r.telefone).slice(0, 13), endereco: texto(r.endereco, 200) };

    let assinatura = typeof b.assinatura === "string" ? b.assinatura : null;
    if (assinatura && (!/^data:image\/(png|jpeg);base64,/.test(assinatura) || assinatura.length > 600000)) {
      return res.status(400).json({ sucesso: false, erro: "Assinatura inválida. Limpe e assine de novo." });
    }
    const separada = b.separada === true;
    if (separada) assinatura = null;
    if (!separada && !assinatura && b.sem_assinatura !== true) {
      return res.status(400).json({ sucesso: false, erro: "Peça para a pessoa assinar com o dedo antes de confirmar." });
    }

    const blocos = (Array.isArray(b.blocos) ? b.blocos : []).slice(0, 200).map(x => ({
      bloco_id: Number(x.bloco_id),
      cartelas: (Array.isArray(x.cartelas) ? x.cartelas : []).map(n => parseInt(n, 10)).filter(Number.isFinite).slice(0, 1000)
    }));

    const { data, error } = await supabase.rpc("fpss_blocos_entregar", {
      p_responsavel: responsavel,
      p_blocos: blocos,
      p_plano_id: Number(b.plano_id) || null,
      p_assinatura: assinatura,
      p_lancador_id: req.lancador.id,
      p_lancador_nome: req.lancador.nome,
      p_distribuidor_id: Number(b.distribuidor_id) || null,
      p_separada: separada
    });
    if (error) return falha(res, error, "Erro ao registrar a entrega.", 409);
    res.json({ sucesso: true, ...data });
  });

  // confirmar a entrega de blocos que estavam só separados (visita feita)
  app.post("/admin/blocos/separacoes/confirmar", ...base, async (req, res) => {
    const b = req.body || {};
    const r = b.responsavel || {};
    let assinatura = typeof b.assinatura === "string" ? b.assinatura : null;
    if (assinatura && (!/^data:image\/(png|jpeg);base64,/.test(assinatura) || assinatura.length > 600000)) {
      return res.status(400).json({ sucesso: false, erro: "Assinatura inválida. Limpe e assine de novo." });
    }
    if (!assinatura && b.sem_assinatura !== true) {
      return res.status(400).json({ sucesso: false, erro: "Peça para a pessoa assinar com o dedo antes de confirmar." });
    }
    const responsavel = r.id
      ? { id: Number(r.id), telefone: soDigitos(r.telefone).slice(0, 13), endereco: texto(r.endereco, 200) }
      : { nome: texto(r.nome, 100), telefone: soDigitos(r.telefone).slice(0, 13), endereco: texto(r.endereco, 200) };
    const entregas = (Array.isArray(b.entregas) ? b.entregas : []).map(Number).filter(Number.isFinite).slice(0, 300);
    const { data, error } = await supabase.rpc("fpss_blocos_confirmar_separacao", {
      p_entregas: entregas, p_responsavel: responsavel, p_distribuidor_id: Number(b.distribuidor_id) || null,
      p_assinatura: assinatura, p_lancador_id: req.lancador.id, p_lancador_nome: req.lancador.nome
    });
    if (error) return falha(res, error, "Erro ao confirmar a entrega.", 409);
    res.json({ sucesso: true, ...data });
  });

  app.post("/admin/blocos/entregas/:id/cancelar", ...base, async (req, res) => {
    const { data, error } = await supabase.rpc("fpss_blocos_cancelar_entrega", {
      p_entrega_id: Number(req.params.id), p_lancador_id: req.lancador.id, p_lancador_nome: req.lancador.nome
    });
    if (error) return falha(res, error, "Erro ao cancelar a entrega.", 409);
    res.json({ sucesso: true, ...data });
  });

  /* ----------------------------- ACERTO ---------------------------- */
  app.post("/admin/blocos/acertar", ...base, async (req, res) => {
    const b = req.body || {};
    const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, 200).map(i => {
      const cartelas = {};
      Object.entries(i.cartelas || {}).slice(0, 1000).forEach(([n, s]) => {
        const num = parseInt(n, 10);
        if (Number.isFinite(num) && ["vendida", "devolvida", "com_responsavel"].includes(s)) cartelas[num] = s;
      });
      const item = { entrega_id: Number(i.entrega_id), cartelas };
      if (typeof i.bonus_usado === "boolean") item.bonus_usado = i.bonus_usado;
      return item;
    });
    const valorPago = arred(String(b.valor_pago ?? 0).replace(",", "."));
    const { data, error } = await supabase.rpc("fpss_blocos_acertar", {
      p_responsavel_id: Number(b.responsavel_id),
      p_itens: itens,
      p_valor_pago: valorPago,
      p_observacao: texto(b.observacao, 300),
      p_lancador_id: req.lancador.id,
      p_lancador_nome: req.lancador.nome
    });
    if (error) return falha(res, error, "Erro ao registrar o acerto.", 409);
    res.json({ sucesso: true, ...data });
  });

  app.post("/admin/blocos/acertos/:id/desfazer", ...base, async (req, res) => {
    const { data, error } = await supabase.rpc("fpss_blocos_desfazer_acerto", {
      p_acerto_id: Number(req.params.id), p_lancador_id: req.lancador.id, p_lancador_nome: req.lancador.nome
    });
    if (error) return falha(res, error, "Erro ao desfazer o acerto.", 409);
    res.json({ sucesso: true, ...data });
  });

  /* ----------------- DISTRIBUIDORES (equipe que entrega) ----------------- */
  app.get("/admin/blocos/distribuidores", ...base, async (req, res) => {
    let q = supabase.from("blocos_distribuidores").select("*").order("nome");
    if (req.query.ativos === "1") q = q.eq("ativo", true);
    const { data, error } = await q;
    if (error) return falha(res, error, "Erro ao carregar distribuidores.");
    res.json({ sucesso: true, distribuidores: data || [] });
  });

  function lerDistribuidor(b) {
    const nome = texto(b.nome, 80).replace(/\s+/g, " ");
    if (!nome) return { erro: "Informe o nome do distribuidor." };
    return { dados: { nome, telefone: soDigitos(b.telefone).slice(0, 13) || null, ativo: b.ativo !== false } };
  }

  app.post("/admin/blocos/distribuidores", ...base, somenteAdmin, async (req, res) => {
    const l = lerDistribuidor(req.body || {});
    if (l.erro) return res.status(400).json({ sucesso: false, erro: l.erro });
    const { error } = await supabase.from("blocos_distribuidores").insert(l.dados);
    if (error) return falha(res, error, error.code === "23505" ? "Já existe um distribuidor com esse nome." : "Erro ao cadastrar o distribuidor.");
    await historico("distribuidor", `Cadastrou o distribuidor ${l.dados.nome}`, l.dados, req.lancador);
    res.json({ sucesso: true });
  });

  app.put("/admin/blocos/distribuidores/:id", ...base, somenteAdmin, async (req, res) => {
    const l = lerDistribuidor(req.body || {});
    if (l.erro) return res.status(400).json({ sucesso: false, erro: l.erro });
    const { error } = await supabase.from("blocos_distribuidores").update(l.dados).eq("id", Number(req.params.id));
    if (error) return falha(res, error, error.code === "23505" ? "Já existe um distribuidor com esse nome." : "Erro ao salvar o distribuidor.");
    await historico("distribuidor", `Alterou o distribuidor ${l.dados.nome}${l.dados.ativo ? "" : " (inativo)"}`, l.dados, req.lancador);
    res.json({ sucesso: true });
  });

  /* -------------------------- COMUNIDADES -------------------------- */
  app.get("/admin/blocos/comunidades", ...base, async (req, res) => {
    let q = supabase.from("blocos_resumo_comunidade").select("*").order("ordem");
    const busca = texto(req.query.busca, 60).replace(/[%,()*]/g, "");
    if (busca) q = q.or(`nome.ilike.%${busca}%,local.ilike.%${busca}%,nomes_responsaveis.ilike.%${busca}%`);
    if (["visita", "caixa", "fechada"].includes(req.query.forma)) q = q.eq("forma", req.query.forma);
    if (req.query.ativas === "1") q = q.eq("ativa", true);
    const { data, error } = await q.limit(500);
    if (error) return falha(res, error, "Erro ao carregar comunidades.");
    res.json({ sucesso: true, comunidades: data || [] });
  });

  app.get("/admin/blocos/comunidades/:id", ...base, async (req, res) => {
    const id = Number(req.params.id);
    const [{ data: c }, { data: resp }] = await Promise.all([
      supabase.from("blocos_resumo_comunidade").select("*").eq("id", id).maybeSingle(),
      supabase.from("blocos_resumo_responsavel").select("*").eq("comunidade_id", id).order("nome")
    ]);
    if (!c) return res.status(404).json({ sucesso: false, erro: "Comunidade não encontrada." });
    res.json({ sucesso: true, comunidade: c, responsaveis: resp || [] });
  });

  function lerComunidade(b) {
    const num1 = v => Math.max(0, Math.round(Number(String(v ?? 0).replace(",", ".")) * 10) / 10 || 0);
    const dados = {
      nome: texto(b.nome, 100),
      local: texto(b.local, 100) || null,
      tipo: texto(b.tipo, 30).toLowerCase() || null,
      forma: ["visita", "caixa", "fechada"].includes(b.forma) ? b.forma : "visita",
      ativa: b.ativa !== false,
      planejado: num1(b.planejado),
      observacao: texto(b.observacao, 300) || null
    };
    if (!dados.nome) return { erro: "Informe o nome da comunidade." };
    return { dados };
  }

  app.put("/admin/blocos/comunidades/:id", ...base, somenteAdmin, async (req, res) => {
    const l = lerComunidade(req.body || {});
    if (l.erro) return res.status(400).json({ sucesso: false, erro: l.erro });
    const id = Number(req.params.id);
    const { data: antes } = await supabase.from("blocos_comunidades").select("*").eq("id", id).maybeSingle();
    if (!antes) return res.status(404).json({ sucesso: false, erro: "Comunidade não encontrada." });
    const { error } = await supabase.from("blocos_comunidades").update(l.dados).eq("id", id);
    if (error) return falha(res, error, "Erro ao salvar a comunidade.");
    await historico("editar_comunidade", `Editou a comunidade ${antes.nome}${antes.local ? " - " + antes.local : ""} (planejado ${String(l.dados.planejado).replace(".", ",")} blocos, ${l.dados.forma}${l.dados.ativa ? "" : ", inativa"})`,
      { id, antes, depois: l.dados }, req.lancador);
    res.json({ sucesso: true });
  });

  app.post("/admin/blocos/comunidades", ...base, somenteAdmin, async (req, res) => {
    const l = lerComunidade(req.body || {});
    if (l.erro) return res.status(400).json({ sucesso: false, erro: l.erro });
    const { data: ult } = await supabase.from("blocos_comunidades").select("ordem").order("ordem", { ascending: false }).limit(1);
    l.dados.ordem = (ult?.[0]?.ordem || 0) + 1;
    const { error } = await supabase.from("blocos_comunidades").insert(l.dados);
    if (error) return falha(res, error, "Erro ao cadastrar a comunidade.");
    await historico("nova_comunidade", `Cadastrou a comunidade ${l.dados.nome}${l.dados.local ? " - " + l.dados.local : ""}`, l.dados, req.lancador);
    res.json({ sucesso: true });
  });

  /* ----------------------------- PAINEL ---------------------------- */
  app.get("/admin/blocos/painel", ...base, async (req, res) => {
    const { data, error } = await supabase.rpc("fpss_blocos_painel");
    if (error) return falha(res, error, "Erro ao carregar o painel.");
    res.json({ sucesso: true, ...data });
  });

  app.get("/admin/blocos/historico", ...base, async (req, res) => {
    const limite = Math.min(500, parseInt(req.query.limite, 10) || 100);
    let q = supabase.from("blocos_historico").select("id, acao, descricao, lancador_nome, created_at")
      .order("created_at", { ascending: false }).limit(limite);
    if (req.query.lancador) q = q.eq("lancador_nome", texto(req.query.lancador, 100));
    const { data, error } = await q;
    if (error) return falha(res, error, "Erro ao carregar o histórico.");
    res.json({ sucesso: true, historico: data || [] });
  });

  /* ------------- CONFERÊNCIA (dia do sorteio): situação ------------- */
  app.get("/admin/blocos/cartela/:numero", ...base, async (req, res) => {
    const n = idCartela(req.params.numero);
    if (!Number.isFinite(n)) return res.status(400).json({ sucesso: false, erro: "Número inválido." });
    const { data: c } = await supabase.from("blocos_cartelas")
      .select("numero, status, entrega_id, atualizado_em, blocos(sequencial, numero_inicial, numero_final)")
      .eq("numero", n).maybeSingle();
    if (!c) return res.json({ sucesso: true, encontrada: false });
    let entrega = null;
    if (c.entrega_id) {
      const { data } = await supabase.from("blocos_entregas")
        .select("plano_nome, created_at, lancador_nome, distribuidor_nome, separada, blocos_responsaveis(id, nome, comunidade, telefone)")
        .eq("id", c.entrega_id).maybeSingle();
      entrega = data;
    }
    res.json({
      sucesso: true, encontrada: true,
      numero: c.numero, status: c.status, atualizado_em: c.atualizado_em,
      bloco: c.blocos,
      responsavel: entrega?.blocos_responsaveis || null,
      plano: entrega?.plano_nome || null,
      entregue_em: entrega?.created_at || null,
      lancador: entrega?.lancador_nome || null,
      distribuidor: entrega?.distribuidor_nome || null,
      separada: entrega?.separada === true
    });
  });
}

module.exports = { registrarRotasBlocos };

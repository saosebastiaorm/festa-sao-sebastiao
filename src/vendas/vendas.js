/* =====================================================================
   FPSS 2027 — VENDAS: carrinho (vários itens por pedido), entrega
   parcial, controle de estoque, termo de retirada e caixa (PDV).

   Tudo que mexe em estoque/entrega passa por funções SQL atômicas no
   Supabase (fpss_*), criadas pelo arquivo
   database/2026-10-04-carrinho-estoque-caixa.sql — assim 15 caixas
   vendendo ao mesmo tempo não "atropelam" uns aos outros.

   registrarRotasVendas(app, deps) registra as rotas novas; as funções
   auxiliares exportadas são usadas também pelo server.js (criar-pix,
   verificar-pagamento, retirada, painel do cliente).
===================================================================== */

const TERMO_VERSAO = "2026-10-04";
const MAX_QTD_ITEM = 100;
const MAX_ITENS_DIFERENTES = 30;

function arred(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

function intPos(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* Erros de RAISE EXCEPTION das funções SQL chegam com a mensagem pronta
   pra mostrar ao usuário; outros erros viram mensagem genérica. */
function mensagemErroSql(error, padrao) {
  const msg = error && (error.message || error.details);
  if (msg && error.code === "P0001") return msg;
  return padrao;
}

/* ---------------------------------------------------------------------
   ITENS: normaliza o carrinho que veio do navegador e confere com o banco.
   NUNCA usa preço vindo do navegador — sempre o preço do banco.
--------------------------------------------------------------------- */
async function montarItensDoCarrinho(supabase, itensBrutos, { conferirEstoque = true } = {}) {

  if (!Array.isArray(itensBrutos) || !itensBrutos.length) {
    return { erro: "Sua lista de compras está vazia." };
  }

  /* junta itens repetidos do mesmo produto (e guarda o horário de
     retirada escolhido para cada produto, quando houver) */
  const porCodigo = new Map();
  const horarioPorCodigo = new Map();
  for (const bruto of itensBrutos) {
    const codigo = String(bruto?.codigo || bruto?.produto_codigo || "").trim().toUpperCase();
    const qtd = intPos(bruto?.quantidade);
    if (!codigo || !qtd) continue;
    porCodigo.set(codigo, (porCodigo.get(codigo) || 0) + qtd);
    const horario = String(bruto?.horario_retirada || "").trim();
    if (/^\d{2}:\d{2}$/.test(horario) && !horarioPorCodigo.has(codigo)) horarioPorCodigo.set(codigo, horario);
  }

  if (!porCodigo.size) return { erro: "Sua lista de compras está vazia." };
  if (porCodigo.size > MAX_ITENS_DIFERENTES) return { erro: "Itens demais no mesmo pedido." };

  const codigos = [...porCodigo.keys()];

  const { data: produtos, error } = await supabase
    .from("produtos")
    .select("id,codigo,nome,preco,ativo,estoque,imagem,descricao,exige_horario")
    .in("codigo", codigos);

  if (error) return { erro: "Erro ao conferir os produtos.", status: 500 };

  const itens = [];
  for (const codigo of codigos) {
    const produto = (produtos || []).find(p => p.codigo === codigo);
    const qtd = porCodigo.get(codigo);

    if (!produto || produto.ativo !== true) {
      return { erro: `Produto indisponível: ${codigo}.` };
    }
    if (qtd > MAX_QTD_ITEM) {
      return { erro: `Quantidade máxima por produto é ${MAX_QTD_ITEM}.` };
    }
    const disponivel = Number(produto.estoque || 0);
    if (conferirEstoque && qtd > disponivel) {
      return {
        erro: disponivel > 0
          ? `Estoque insuficiente de ${produto.nome}: restam ${disponivel}.`
          : `${produto.nome} esgotado.`,
        esgotado: produto.codigo
      };
    }

    itens.push({
      produto_id: produto.id,
      produto_codigo: produto.codigo,
      produto_nome: produto.nome,
      preco_unitario: arred(produto.preco),
      quantidade: qtd,
      exige_horario: produto.exige_horario === true,
      horario_retirada: produto.exige_horario === true ? (horarioPorCodigo.get(produto.codigo) || null) : null,
      imagem: produto.imagem || null,
      descricao: produto.descricao || null
    });
  }

  const total = arred(itens.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0));
  const quantidadeTotal = itens.reduce((s, i) => s + i.quantidade, 0);

  return { itens, total, quantidadeTotal };
}

function cpfValido(cpf) {
  cpf = String(cpf || "").replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(cpf[i]) * (10 - i);
  let d1 = (soma * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== Number(cpf[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(cpf[i]) * (11 - i);
  let d2 = (soma * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === Number(cpf[10]);
}

/* Na venda do caixa: vai ficar item pendente? (entregar < comprado) */
function vendaTemPendencia(itens, entregar) {
  if (!Array.isArray(entregar)) return false; // sem lista = entrega tudo
  return itens.some(i => {
    const e = entregar.find(x => String(x?.codigo || "").trim().toUpperCase() === i.produto_codigo);
    return !e || intPos(e.quantidade) < i.quantidade;
  });
}

function resumoItensTexto(itens) {
  return (itens || []).map(i => `${i.quantidade}x ${i.produto_nome}`).join(" + ");
}

function itensParaSql(itens) {
  return itens.map(i => ({
    produto_id: i.produto_id,
    produto_codigo: i.produto_codigo,
    produto_nome: i.produto_nome,
    preco_unitario: i.preco_unitario,
    quantidade: i.quantidade,
    exige_horario: i.exige_horario,
    horario_retirada: i.horario_retirada || null
  }));
}

async function criarPedidoComItens(supabase, pedido, itens, prefixo, pagamentos) {
  const { data, error } = await supabase.rpc("fpss_criar_pedido", {
    p_pedido: pedido,
    p_itens: itensParaSql(itens),
    p_prefixo: prefixo,
    p_pagamentos: Array.isArray(pagamentos) ? pagamentos : []
  });
  if (error || !data) {
    console.error("[VENDAS] ERRO fpss_criar_pedido:", error);
    return { erro: "Erro ao salvar pedido." };
  }
  return { id: data.id, codigo_pedido: data.codigo_pedido };
}

/* ---------------------------------------------------------------------
   ITENS + ENTREGAS de um ou vários pedidos (pra telas)
--------------------------------------------------------------------- */
async function anexarItens(supabase, pedidos, { comEntregas = false } = {}) {
  const lista = Array.isArray(pedidos) ? pedidos : [pedidos];
  const ids = lista.filter(Boolean).map(p => p.id);
  if (!ids.length) return lista;

  const { data: itens } = await supabase
    .from("pedido_itens")
    .select("id,pedido_id,produto_id,produto_codigo,produto_nome,preco_unitario,quantidade,quantidade_entregue,exige_horario,horario_retirada")
    .in("pedido_id", ids)
    .order("id", { ascending: true });

  let entregas = [];
  if (comEntregas) {
    const { data } = await supabase
      .from("pedido_entregas")
      .select("id,pedido_id,pedido_item_id,quantidade,entregue_em,entregue_por_nome,origem")
      .in("pedido_id", ids)
      .order("entregue_em", { ascending: true });
    entregas = data || [];
  }

  for (const p of lista) {
    if (!p) continue;
    const meus = (itens || []).filter(i => i.pedido_id === p.id).map(i => ({
      ...i,
      quantidade_pendente: i.quantidade - i.quantidade_entregue
    }));
    p.itens = meus;
    p.resumo_itens = resumoItensTexto(meus);
    p.quantidade_pendente_total = meus.reduce((s, i) => s + i.quantidade_pendente, 0);
    if (comEntregas) {
      p.entregas = entregas
        .filter(e => e.pedido_id === p.id)
        .map(e => ({
          ...e,
          produto_nome: (meus.find(i => i.id === e.pedido_item_id) || {}).produto_nome || ""
        }));
    }
  }
  return lista;
}

/* ---------------------------------------------------------------------
   CONFIRMAÇÃO DE PAGAMENTO (única pra todo lugar: tela do Pix, caixa,
   retirada, painel admin e conferência automática em segundo plano)
--------------------------------------------------------------------- */
async function marcarPedidoComoPago(supabase, pedido) {

  let tokenRetirada = pedido.token_retirada;
  let qrCodeRetirada = pedido.qr_code_retirada;
  const atualizacao = {};

  if (pedido.status_pagamento !== "pago") {
    atualizacao.status_pagamento = "pago";
    atualizacao.status = "pago";
    atualizacao.data_pagamento = new Date();
  }

  if (!tokenRetirada || !qrCodeRetirada) {
    tokenRetirada = `RET-${pedido.codigo_pedido}-${Date.now()}`.replaceAll(" ", "");
    qrCodeRetirada = `${pedido.codigo_pedido}|${pedido.cpf || ""}|${tokenRetirada}`;
    atualizacao.token_retirada = tokenRetirada;
    atualizacao.qr_code_retirada = qrCodeRetirada;
  }

  if (Object.keys(atualizacao).length) {
    const { error } = await supabase.from("pedidos").update(atualizacao).eq("id", pedido.id);
    if (error) console.error("[VENDAS] Erro ao marcar pedido como pago:", error);
  }

  /* baixa o estoque disponível (a função SQL garante que é uma vez só) */
  if (!pedido.estoque_baixado) {
    const { error } = await supabase.rpc("fpss_baixar_estoque_pedido", { p_pedido_id: pedido.id });
    if (error) console.error("[VENDAS] Erro ao baixar estoque:", error);
  }

  return {
    ...pedido,
    ...atualizacao,
    status_pagamento: "pago",
    token_retirada: tokenRetirada,
    qr_code_retirada: qrCodeRetirada
  };
}

/* Consulta o Sicredi e, se pago, confirma. Devolve o pedido atualizado. */
async function conferirPagamentoPedido(supabase, consultarPix, pedido) {
  if (!pedido || !pedido.txid) return { pedido, statusSicredi: null };
  if (pedido.status_pagamento === "pago") {
    if (!pedido.estoque_baixado) pedido = await marcarPedidoComoPago(supabase, pedido);
    return { pedido, statusSicredi: "CONCLUIDA" };
  }
  try {
    const pagamento = await consultarPix(pedido.txid);
    if (pagamento && pagamento.status === "CONCLUIDA") {
      return { pedido: await marcarPedidoComoPago(supabase, pedido), statusSicredi: "CONCLUIDA" };
    }
    return { pedido, statusSicredi: pagamento ? pagamento.status : null };
  } catch (erro) {
    console.error("[VENDAS] Falha ao consultar Pix", pedido.txid, erro.message);
    return { pedido, statusSicredi: null, falhou: true };
  }
}

/* Conferência automática: pedidos com Pix pendente criados nas últimas
   horas. Resolve o caso de quem pagou e fechou a página antes da
   confirmação (o estoque e o status ficariam errados). */
function iniciarConferenciaAutomatica(supabase, consultarPix) {
  let rodando = false;
  const rodar = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const desde = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const { data: pendentes } = await supabase
        .from("pedidos")
        .select("*")
        .neq("status_pagamento", "pago")
        .not("txid", "is", null)
        .is("reembolsado_em", null)
        .neq("status", "cancelado")
        .gte("created_at", desde)
        .order("id", { ascending: false })
        .limit(40);

      for (const pedido of pendentes || []) {
        await conferirPagamentoPedido(supabase, consultarPix, pedido);
      }

      /* pagos cujo estoque ainda não baixou (ex.: falha momentânea) */
      const { data: semBaixa } = await supabase
        .from("pedidos")
        .select("id,estoque_baixado")
        .eq("status_pagamento", "pago")
        .eq("estoque_baixado", false)
        .is("reembolsado_em", null)
        .limit(40);
      for (const p of semBaixa || []) {
        await supabase.rpc("fpss_baixar_estoque_pedido", { p_pedido_id: p.id });
      }
    } catch (erro) {
      console.error("[VENDAS] Erro na conferência automática:", erro.message);
    } finally {
      rodando = false;
    }
  };
  setTimeout(rodar, 20 * 1000);
  return setInterval(rodar, 2 * 60 * 1000);
}

/* ---------------------------------------------------------------------
   ENTREGA (retirada e caixa)
--------------------------------------------------------------------- */
async function registrarEntrega(supabase, pedido, itensEntrega, usuario, origem) {

  let itens = itensEntrega;

  /* sem lista = entrega tudo que falta (compatível com a tela antiga) */
  if (!Array.isArray(itens) || !itens.length) {
    const { data } = await supabase
      .from("pedido_itens")
      .select("id,quantidade,quantidade_entregue")
      .eq("pedido_id", pedido.id);
    itens = (data || [])
      .map(i => ({ item_id: i.id, quantidade: i.quantidade - i.quantidade_entregue }))
      .filter(i => i.quantidade > 0);
  }

  itens = itens
    .map(i => ({ item_id: Number(i.item_id), quantidade: intPos(i.quantidade) }))
    .filter(i => i.item_id && i.quantidade > 0);

  if (!itens.length) {
    return { erro: "Nenhuma quantidade informada para entrega." };
  }

  const { data, error } = await supabase.rpc("fpss_registrar_entrega", {
    p_pedido_id: pedido.id,
    p_itens: itens,
    p_usuario_id: usuario?.id || null,
    p_usuario_nome: usuario?.nome || null,
    p_origem: origem || "retirada"
  });

  if (error) {
    console.error("[VENDAS] Erro ao registrar entrega:", error);
    return { erro: mensagemErroSql(error, "Erro ao registrar a entrega.") };
  }
  return { resultado: data };
}

/* ---------------------------------------------------------------------
   CAIXA — confere a lista de pagamentos de uma venda
   forma única: [{forma, valor: total, valor_recebido?}]
   dividido   : várias linhas; soma dos valores = total; no máximo 1 Pix
                e 1 dinheiro (o troco sai do dinheiro)
--------------------------------------------------------------------- */
function montarPagamentosCaixa(body, total) {
  const formasValidas = ["dinheiro", "pix", "cartao"];
  let brutos;

  if (body?.forma_pagamento === "misto" || Array.isArray(body?.pagamentos)) {
    brutos = Array.isArray(body?.pagamentos) ? body.pagamentos : [];
  } else if (formasValidas.includes(body?.forma_pagamento)) {
    brutos = [{ forma: body.forma_pagamento, valor: total, valor_recebido: body.valor_recebido }];
  } else {
    return { erro: "Escolha a forma de pagamento." };
  }

  const pagamentos = [];
  for (const b of brutos) {
    const forma = String(b?.forma || "");
    const valor = arred(b?.valor);
    if (!formasValidas.includes(forma)) return { erro: "Forma de pagamento inválida." };
    if (!(valor > 0)) return { erro: "Cada pagamento precisa ter valor maior que zero." };
    const linha = { forma, valor, valor_recebido: null, troco: null };
    if (forma === "dinheiro") {
      const recebido = b?.valor_recebido === undefined || b?.valor_recebido === null || b?.valor_recebido === ""
        ? valor
        : arred(b.valor_recebido);
      if (recebido < valor) return { erro: "Valor recebido em dinheiro menor que a parte em dinheiro." };
      linha.valor_recebido = recebido;
      linha.troco = arred(recebido - valor);
    }
    pagamentos.push(linha);
  }

  if (!pagamentos.length) return { erro: "Informe as formas de pagamento." };
  if (pagamentos.filter(p => p.forma === "pix").length > 1) return { erro: "Use no máximo um Pix por venda." };
  if (pagamentos.filter(p => p.forma === "dinheiro").length > 1) return { erro: "Junte as partes em dinheiro numa só." };

  const soma = arred(pagamentos.reduce((s, p) => s + p.valor, 0));
  if (Math.abs(soma - total) > 0.001) {
    return { erro: `A soma dos pagamentos (R$ ${soma.toFixed(2).replace(".", ",")}) não fecha com o total (R$ ${total.toFixed(2).replace(".", ",")}).` };
  }

  const dinheiro = pagamentos.find(p => p.forma === "dinheiro");
  const pix = pagamentos.find(p => p.forma === "pix");

  return {
    pagamentos,
    forma: pagamentos.length > 1 ? "misto" : pagamentos[0].forma,
    valorPix: pix ? pix.valor : 0,
    valorRecebido: dinheiro ? dinheiro.valor_recebido : null,
    troco: dinheiro ? dinheiro.troco : null
  };
}

/* ---------------------------------------------------------------------
   CAIXA — resumo de uma sessão
--------------------------------------------------------------------- */
async function resumoSessaoCaixa(supabase, sessao) {

  const { data: vendas } = await supabase
    .from("pedidos")
    .select("id,codigo_pedido,valor_total,forma_pagamento,status_pagamento,status_retirada,reembolsado_em,created_at,nome,valor_recebido,troco")
    .eq("caixa_sessao_id", sessao.id)
    .order("id", { ascending: false });

  const { data: movimentos } = await supabase
    .from("caixa_movimentos")
    .select("*")
    .eq("sessao_id", sessao.id)
    .order("id", { ascending: true });

  const pagas = (vendas || []).filter(v => v.status_pagamento === "pago" && !v.reembolsado_em);

  /* totais por forma vêm das linhas de pagamento (venda dividida conta
     cada parte na sua forma); venda sem linhas usa a forma do pedido */
  let linhasPagamento = [];
  if (pagas.length) {
    const { data } = await supabase
      .from("pedido_pagamentos")
      .select("pedido_id,forma,valor")
      .in("pedido_id", pagas.map(v => v.id));
    linhasPagamento = data || [];
  }
  const comLinhas = new Set(linhasPagamento.map(l => l.pedido_id));
  const soma = forma => arred(
    linhasPagamento.filter(l => l.forma === forma).reduce((s, l) => s + Number(l.valor || 0), 0) +
    pagas.filter(v => !comLinhas.has(v.id) && v.forma_pagamento === forma).reduce((s, v) => s + Number(v.valor_total || 0), 0)
  );

  const totalDinheiro = soma("dinheiro");
  const totalPix = soma("pix");
  const totalCartao = soma("cartao");
  const sangrias = arred((movimentos || []).filter(m => m.tipo === "sangria").reduce((s, m) => s + Number(m.valor), 0));
  const suprimentos = arred((movimentos || []).filter(m => m.tipo === "suprimento").reduce((s, m) => s + Number(m.valor), 0));
  const dinheiroEsperado = arred(Number(sessao.troco_inicial || 0) + totalDinheiro + suprimentos - sangrias);

  return {
    sessao,
    vendas: vendas || [],
    movimentos: movimentos || [],
    totais: {
      quantidade_vendas: pagas.length,
      dinheiro: totalDinheiro,
      pix: totalPix,
      cartao: totalCartao,
      geral: arred(totalDinheiro + totalPix + totalCartao),
      sangrias,
      suprimentos,
      troco_inicial: arred(sessao.troco_inicial),
      dinheiro_esperado: dinheiroEsperado,
      pendentes_pix: (vendas || []).filter(v => (v.forma_pagamento === "pix" || v.forma_pagamento === "misto") && v.status_pagamento !== "pago" && v.status_pagamento !== "cancelado").length
    }
  };
}

/* =====================================================================
   ROTAS
===================================================================== */
function registrarRotasVendas(app, deps) {

  const {
    supabase,
    criarPix,
    consultarPix,
    verificarAdminBackend,
    verificarAcessoRetirada,
    limitadorOperador,
    sanitizarTexto,
    codigoPedidoValido
  } = deps;

  /* Caixa: admin e padrão (cada um com o próprio login) */
  const acessoCaixa = [verificarAcessoRetirada, limitadorOperador];

  function usuarioDaReq(req) {
    return {
      id: req.usuarioAdmin?.id || null,
      nome: req.nomeUsuario || req.usuarioAdmin?.email || "Equipe",
      email: req.usuarioAdmin?.email || null
    };
  }

  async function sessaoAberta(usuarioId) {
    const { data } = await supabase
      .from("caixa_sessoes")
      .select("*")
      .eq("usuario_id", usuarioId)
      .eq("status", "aberto")
      .maybeSingle();
    return data || null;
  }

  async function buscarVendaDoCaixa(req, id) {
    const { data: pedido } = await supabase
      .from("pedidos")
      .select("*")
      .eq("id", Number(id))
      .eq("origem", "caixa")
      .maybeSingle();
    if (!pedido) return null;
    /* padrão só mexe nas próprias vendas; admin em qualquer uma */
    if (req.papelUsuario !== "admin" && pedido.vendedor_id !== req.usuarioAdmin.id) return null;
    return pedido;
  }

  /* ----------------------- CAIXA: PRODUTOS ------------------------ */
  app.get("/caixa/produtos", ...acessoCaixa, async (req, res) => {
    const { data, error } = await supabase
      .from("produtos")
      .select("id,codigo,nome,preco,imagem,estoque,exige_horario,ordem")
      .eq("ativo", true)
      .order("ordem", { ascending: true });
    if (error) return res.status(500).json({ sucesso: false, erro: "Erro ao carregar produtos." });
    return res.json({
      sucesso: true,
      produtos: (data || []).map(p => ({ ...p, disponivel: Number(p.estoque || 0), esgotado: Number(p.estoque || 0) <= 0 }))
    });
  });

  /* ----------------------- CAIXA: SESSÃO -------------------------- */
  app.get("/caixa/sessao", ...acessoCaixa, async (req, res) => {
    const u = usuarioDaReq(req);
    const sessao = await sessaoAberta(u.id);
    if (!sessao) return res.json({ sucesso: true, aberta: false, operador: u.nome, papel: req.papelUsuario });
    const resumo = await resumoSessaoCaixa(supabase, sessao);
    return res.json({ sucesso: true, aberta: true, operador: u.nome, papel: req.papelUsuario, ...resumo });
  });

  app.post("/caixa/abrir", ...acessoCaixa, async (req, res) => {
    const u = usuarioDaReq(req);
    const trocoInicial = arred(req.body?.troco_inicial);
    if (trocoInicial < 0 || trocoInicial > 100000) {
      return res.status(400).json({ sucesso: false, erro: "Valor de troco inicial inválido." });
    }
    const existente = await sessaoAberta(u.id);
    if (existente) return res.json({ sucesso: true, sessao: existente, ja_aberta: true });

    /* número do caixa (Caixa 1, Caixa 2...) — não pode estar aberto em outro login */
    const numero = Math.floor(Number(req.body?.numero));
    if (!Number.isFinite(numero) || numero < 1 || numero > 99) {
      return res.status(400).json({ sucesso: false, erro: "Informe o número do caixa (1 a 99)." });
    }
    const { data: ocupado } = await supabase
      .from("caixa_sessoes")
      .select("id,usuario_nome")
      .eq("status", "aberto")
      .eq("numero", numero)
      .maybeSingle();
    if (ocupado) {
      return res.status(409).json({ sucesso: false, erro: `O Caixa ${numero} já está aberto com ${ocupado.usuario_nome || "outra pessoa"}. Escolha outro número.` });
    }

    const { data, error } = await supabase
      .from("caixa_sessoes")
      .insert([{ usuario_id: u.id, usuario_nome: u.nome, usuario_email: u.email, troco_inicial: trocoInicial, numero }])
      .select()
      .single();
    if (error && error.code === "23505") {
      return res.status(409).json({ sucesso: false, erro: `O Caixa ${numero} acabou de ser aberto por outra pessoa. Escolha outro número.` });
    }
    if (error) {
      console.error("[CAIXA] erro abrir:", error);
      return res.status(500).json({ sucesso: false, erro: "Erro ao abrir o caixa." });
    }
    return res.json({ sucesso: true, sessao: data });
  });

  app.post("/caixa/movimento", ...acessoCaixa, async (req, res) => {
    const u = usuarioDaReq(req);
    const sessao = await sessaoAberta(u.id);
    if (!sessao) return res.status(400).json({ sucesso: false, erro: "Abra o caixa primeiro." });
    const tipo = req.body?.tipo === "suprimento" ? "suprimento" : "sangria";
    const valor = arred(req.body?.valor);
    if (!(valor > 0)) return res.status(400).json({ sucesso: false, erro: "Informe um valor maior que zero." });
    const { error } = await supabase.from("caixa_movimentos").insert([{
      sessao_id: sessao.id, tipo, valor, motivo: sanitizarTexto(req.body?.motivo, 200) || null
    }]);
    if (error) return res.status(500).json({ sucesso: false, erro: "Erro ao registrar." });
    return res.json({ sucesso: true });
  });

  app.post("/caixa/fechar", ...acessoCaixa, async (req, res) => {
    const u = usuarioDaReq(req);
    const sessao = await sessaoAberta(u.id);
    if (!sessao) return res.status(400).json({ sucesso: false, erro: "Nenhum caixa aberto." });

    const contado = req.body?.dinheiro_contado;
    if (contado === undefined || contado === null || contado === "" || !(Number(contado) >= 0)) {
      return res.status(400).json({ sucesso: false, erro: "Informe quanto de dinheiro foi contado." });
    }

    const resumo = await resumoSessaoCaixa(supabase, sessao);
    if (resumo.totais.pendentes_pix > 0 && req.body?.forcar !== true) {
      return res.status(409).json({
        sucesso: false,
        erro: `Existem ${resumo.totais.pendentes_pix} venda(s) Pix aguardando pagamento. Confirme ou cancele antes de fechar.`,
        pendentes_pix: resumo.totais.pendentes_pix
      });
    }

    const dinheiroContado = arred(contado);
    const atualizacao = {
      status: "fechado",
      fechado_em: new Date().toISOString(),
      dinheiro_contado: dinheiroContado,
      dinheiro_esperado: resumo.totais.dinheiro_esperado,
      diferenca: arred(dinheiroContado - resumo.totais.dinheiro_esperado),
      total_dinheiro: resumo.totais.dinheiro,
      total_pix: resumo.totais.pix,
      total_cartao: resumo.totais.cartao,
      observacao_fechamento: sanitizarTexto(req.body?.observacao, 500) || null
    };
    const { data, error } = await supabase
      .from("caixa_sessoes").update(atualizacao).eq("id", sessao.id).select().single();
    if (error) return res.status(500).json({ sucesso: false, erro: "Erro ao fechar o caixa." });
    return res.json({ sucesso: true, sessao: data, totais: resumo.totais });
  });

  /* ----------------------- CAIXA: VENDA --------------------------- */
  app.post("/caixa/venda", ...acessoCaixa, async (req, res) => {
    try {
      const u = usuarioDaReq(req);
      const sessao = await sessaoAberta(u.id);
      if (!sessao) return res.status(400).json({ sucesso: false, erro: "Abra o caixa antes de vender." });

      const montagem = await montarItensDoCarrinho(supabase, req.body?.itens);
      if (montagem.erro) return res.status(montagem.status || 400).json({ sucesso: false, erro: montagem.erro, esgotado: montagem.esgotado });

      const { itens, total, quantidadeTotal } = montagem;
      if (!(total > 0)) return res.status(400).json({ sucesso: false, erro: "Total inválido." });

      const pg = montarPagamentosCaixa(req.body, total);
      if (pg.erro) return res.status(400).json({ sucesso: false, erro: pg.erro });
      const { pagamentos, forma, valorPix, valorRecebido, troco } = pg;

      /* dados do cliente: obrigatórios (e CPF validado) quando fica item
         pendente — a Retirada encontra o pedido pelo CPF ou pelo código */
      const nomeInformado = sanitizarTexto(req.body?.cliente_nome, 100);
      const telefoneCliente = String(req.body?.cliente_telefone || "").replace(/\D/g, "");
      const cpfCliente = String(req.body?.cliente_cpf || "").replace(/\D/g, "");
      if (vendaTemPendencia(itens, req.body?.entregar)) {
        if (!nomeInformado || nomeInformado.length < 3) {
          return res.status(400).json({ sucesso: false, erro: "Vai ficar item pendente: informe o nome do cliente." });
        }
        if (telefoneCliente.length < 10 || telefoneCliente.length > 11) {
          return res.status(400).json({ sucesso: false, erro: "Informe o telefone do cliente com DDD." });
        }
        if (!cpfValido(cpfCliente)) {
          return res.status(400).json({ sucesso: false, erro: "CPF do cliente inválido." });
        }
      }
      const nomeCliente = nomeInformado || "Cliente do caixa";

      let pagamento = null;
      if (valorPix > 0) {
        pagamento = await criarPix(valorPix, null, null, { expiracao: 1800, descricao: "FPSS 2027 - Caixa" });
        if (!pagamento || !pagamento.pixCopiaECola) {
          return res.status(502).json({ sucesso: false, erro: "Não foi possível gerar o Pix agora. Tente de novo." });
        }
      }

      /* com parte em Pix, a venda só fica paga quando o Pix cair */
      const pago = !(valorPix > 0);
      const agora = new Date().toISOString();

      const criado = await criarPedidoComItens(supabase, {
        nome: nomeCliente,
        sobrenome: "",
        cpf: cpfValido(cpfCliente) ? cpfCliente : null,
        telefone: telefoneCliente.length >= 10 ? telefoneCliente : null,
        produto_tipo: itens.length === 1 ? itens[0].produto_codigo : "MIX",
        quantidade: quantidadeTotal,
        valor_total: total,
        txid: pagamento ? pagamento.txid : null,
        pix_copia_cola: pagamento ? pagamento.pixCopiaECola : null,
        status_pagamento: pago ? "pago" : "pendente",
        status_retirada: "pendente",
        status: pago ? "pago" : "pendente",
        origem: "caixa",
        forma_pagamento: forma,
        valor_recebido: valorRecebido,
        troco,
        vendedor_id: u.id,
        vendedor_nome: u.nome,
        caixa_sessao_id: sessao.id,
        data_pagamento: pago ? agora : null
      }, itens, "CX", pagamentos);

      if (criado.erro) return res.status(500).json({ sucesso: false, erro: criado.erro });

      let { data: pedido } = await supabase.from("pedidos").select("*").eq("id", criado.id).single();

      let entrega = null;
      if (pago) {
        pedido = await marcarPedidoComoPago(supabase, pedido);
        const entregarAgora = mapearEntregaPorCodigo(req.body?.entregar, pedido.id);
        entrega = await entregarPorCodigo(pedido, entregarAgora, u);
        const { data: recarregado } = await supabase.from("pedidos").select("*").eq("id", pedido.id).single();
        if (recarregado) pedido = recarregado;
      }

      await anexarItens(supabase, pedido, { comEntregas: true });

      return res.json({
        sucesso: true,
        pedido: limparPedidoCaixa(pedido),
        total,
        troco,
        pix_copia_cola: pagamento ? pagamento.pixCopiaECola : null,
        valor_pix: valorPix,
        pagamentos,
        entrega
      });
    } catch (erro) {
      console.error("[CAIXA] ERRO VENDA:", erro);
      return res.status(500).json({ sucesso: false, erro: "Erro interno ao registrar a venda." });
    }
  });

  /* entregar = [{codigo, quantidade}] -> converte pra item_id na hora de entregar */
  function mapearEntregaPorCodigo(entregar) {
    if (!Array.isArray(entregar)) return null; // null = entregar tudo
    return entregar.map(e => ({
      codigo: String(e?.codigo || "").trim().toUpperCase(),
      quantidade: intPos(e?.quantidade)
    }));
  }

  async function entregarPorCodigo(pedido, entregarPorCod, u) {
    const { data: itensPedido } = await supabase
      .from("pedido_itens")
      .select("id,produto_codigo,quantidade,quantidade_entregue")
      .eq("pedido_id", pedido.id);

    let lista;
    if (entregarPorCod === null) {
      lista = (itensPedido || []).map(i => ({ item_id: i.id, quantidade: i.quantidade - i.quantidade_entregue }));
    } else {
      lista = entregarPorCod.map(e => {
        const item = (itensPedido || []).find(i => i.produto_codigo === e.codigo);
        if (!item) return null;
        return { item_id: item.id, quantidade: Math.min(e.quantidade, item.quantidade - item.quantidade_entregue) };
      }).filter(Boolean);
    }
    lista = lista.filter(i => i.quantidade > 0);
    if (!lista.length) return { status_retirada: "pendente", entregue_agora: 0 };

    const r = await registrarEntrega(supabase, pedido, lista, u, "caixa");
    if (r.erro) return { erro: r.erro };
    return r.resultado;
  }

  function limparPedidoCaixa(p) {
    return {
      id: p.id,
      codigo_pedido: p.codigo_pedido,
      nome: p.nome,
      valor_total: p.valor_total,
      forma_pagamento: p.forma_pagamento,
      valor_recebido: p.valor_recebido,
      troco: p.troco,
      status_pagamento: p.status_pagamento,
      status_retirada: p.status_retirada,
      qr_code_retirada: p.qr_code_retirada,
      created_at: p.created_at,
      itens: p.itens,
      entregas: p.entregas,
      quantidade_pendente_total: p.quantidade_pendente_total,
      resumo_itens: p.resumo_itens
    };
  }

  /* Status de uma venda Pix do caixa (consulta o Sicredi) */
  app.get("/caixa/venda/:id/status", ...acessoCaixa, async (req, res) => {
    let pedido = await buscarVendaDoCaixa(req, req.params.id);
    if (!pedido) return res.status(404).json({ sucesso: false, erro: "Venda não encontrada." });
    const r = await conferirPagamentoPedido(supabase, consultarPix, pedido);
    pedido = r.pedido;
    await anexarItens(supabase, pedido, { comEntregas: true });
    return res.json({ sucesso: true, pago: pedido.status_pagamento === "pago", pedido: limparPedidoCaixa(pedido) });
  });

  /* Entregar itens de uma venda do caixa (depois do Pix, ou pendências) */
  app.post("/caixa/venda/:id/entregar", ...acessoCaixa, async (req, res) => {
    const u = usuarioDaReq(req);
    let pedido = await buscarVendaDoCaixa(req, req.params.id);
    if (!pedido) return res.status(404).json({ sucesso: false, erro: "Venda não encontrada." });
    if (pedido.status_pagamento !== "pago") {
      const r = await conferirPagamentoPedido(supabase, consultarPix, pedido);
      pedido = r.pedido;
      if (pedido.status_pagamento !== "pago") return res.status(400).json({ sucesso: false, erro: "Pagamento ainda não confirmado." });
    }
    const entrega = await entregarPorCodigo(pedido, mapearEntregaPorCodigo(req.body?.entregar), u);
    if (entrega && entrega.erro) return res.status(400).json({ sucesso: false, erro: entrega.erro });
    const { data: atualizado } = await supabase.from("pedidos").select("*").eq("id", pedido.id).single();
    await anexarItens(supabase, atualizado, { comEntregas: true });
    return res.json({ sucesso: true, entrega, pedido: limparPedidoCaixa(atualizado) });
  });

  /* Cancelar venda Pix que não foi paga */
  app.post("/caixa/venda/:id/cancelar", ...acessoCaixa, async (req, res) => {
    let pedido = await buscarVendaDoCaixa(req, req.params.id);
    if (!pedido) return res.status(404).json({ sucesso: false, erro: "Venda não encontrada." });
    /* confere uma última vez: se o cliente pagou, não cancela */
    const r = await conferirPagamentoPedido(supabase, consultarPix, pedido);
    if (r.pedido.status_pagamento === "pago") {
      return res.status(409).json({ sucesso: false, erro: "Este Pix já foi pago — a venda não pode ser cancelada.", pago: true });
    }
    await supabase.from("pedidos")
      .update({ status_pagamento: "cancelado", status: "cancelado" })
      .eq("id", pedido.id).neq("status_pagamento", "pago");
    return res.json({ sucesso: true });
  });

  /* ----------------------- ADMIN: ESTOQUE ------------------------- */
  app.get("/admin/estoque", verificarAdminBackend, async (req, res) => {
    const { data, error } = await supabase
      .from("produtos")
      .select("id,codigo,nome,imagem,preco,ativo,estoque,estoque_fisico,estoque_minimo,exige_horario,ordem")
      .order("ordem", { ascending: true });
    if (error) return res.status(500).json({ sucesso: false, erro: "Erro ao carregar estoque." });
    return res.json({
      sucesso: true,
      produtos: (data || []).map(p => {
        const disponivel = Number(p.estoque || 0);
        const fisico = Number(p.estoque_fisico ?? p.estoque ?? 0);
        const minimo = Number(p.estoque_minimo ?? 10);
        return {
          ...p,
          disponivel,
          em_estoque: fisico,
          a_entregar: fisico - disponivel,
          alerta: disponivel < 0 ? "negativo" : disponivel === 0 ? "esgotado" : disponivel <= minimo ? "baixo" : null
        };
      })
    });
  });

  app.post("/admin/estoque/movimentar", verificarAdminBackend, async (req, res) => {
    const u = usuarioDaReq(req);
    const tipo = String(req.body?.tipo || "");
    const quantidade = Math.floor(Number(req.body?.quantidade));
    const produtoId = Number(req.body?.produto_id);
    if (!produtoId || !["entrada", "saida", "ajuste"].includes(tipo) || !Number.isFinite(quantidade)) {
      return res.status(400).json({ sucesso: false, erro: "Dados inválidos." });
    }
    const { data, error } = await supabase.rpc("fpss_movimentar_estoque", {
      p_produto_id: produtoId,
      p_tipo: tipo,
      p_quantidade: quantidade,
      p_motivo: sanitizarTexto(req.body?.motivo, 200) || null,
      p_usuario_id: u.id,
      p_usuario_nome: u.nome
    });
    if (error) return res.status(400).json({ sucesso: false, erro: mensagemErroSql(error, "Erro ao movimentar estoque.") });
    return res.json({ sucesso: true, resultado: data });
  });

  app.get("/admin/estoque/historico", verificarAdminBackend, async (req, res) => {
    let consulta = supabase
      .from("estoque_movimentos")
      .select("id,produto_id,tipo,delta_disponivel,delta_fisico,disponivel_apos,fisico_apos,motivo,pedido_id,usuario_nome,created_at")
      .order("id", { ascending: false })
      .limit(Math.min(Number(req.query.limite) || 200, 1000));
    if (req.query.produto_id) consulta = consulta.eq("produto_id", Number(req.query.produto_id));
    const { data, error } = await consulta;
    if (error) return res.status(500).json({ sucesso: false, erro: "Erro ao carregar histórico." });
    return res.json({ sucesso: true, movimentos: data || [] });
  });

  /* ----------------------- ADMIN: CAIXAS -------------------------- */
  app.get("/admin/caixas", verificarAdminBackend, async (req, res) => {
    const { data: sessoes, error } = await supabase
      .from("caixa_sessoes")
      .select("*")
      .order("id", { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ sucesso: false, erro: "Erro ao carregar caixas." });

    // sangrias/suprimentos de todos os caixas listados (abertos e fechados)
    const ids = (sessoes || []).map(s => s.id);
    const movPorSessao = {};
    if (ids.length) {
      const { data: movs } = await supabase
        .from("caixa_movimentos")
        .select("sessao_id, tipo, valor")
        .in("sessao_id", ids);
      for (const m of movs || []) {
        const t = movPorSessao[m.sessao_id] || (movPorSessao[m.sessao_id] = { sangrias: 0, suprimentos: 0 });
        if (m.tipo === "sangria") t.sangrias = arred(t.sangrias + Number(m.valor || 0));
        else if (m.tipo === "suprimento") t.suprimentos = arred(t.suprimentos + Number(m.valor || 0));
      }
    }

    const resultado = [];
    for (const s of sessoes || []) {
      const mov = movPorSessao[s.id] || { sangrias: 0, suprimentos: 0 };
      if (s.status === "aberto") {
        const r = await resumoSessaoCaixa(supabase, s);
        resultado.push({ ...s, totais: r.totais });
      } else {
        resultado.push({
          ...s,
          totais: {
            dinheiro: Number(s.total_dinheiro || 0),
            pix: Number(s.total_pix || 0),
            cartao: Number(s.total_cartao || 0),
            geral: arred(Number(s.total_dinheiro || 0) + Number(s.total_pix || 0) + Number(s.total_cartao || 0)),
            dinheiro_esperado: Number(s.dinheiro_esperado || 0),
            sangrias: mov.sangrias,
            suprimentos: mov.suprimentos
          }
        });
      }
    }
    return res.json({ sucesso: true, caixas: resultado });
  });

  app.get("/admin/caixas/:id", verificarAdminBackend, async (req, res) => {
    const { data: sessao } = await supabase.from("caixa_sessoes").select("*").eq("id", Number(req.params.id)).maybeSingle();
    if (!sessao) return res.status(404).json({ sucesso: false, erro: "Caixa não encontrado." });
    const resumo = await resumoSessaoCaixa(supabase, sessao);
    return res.json({ sucesso: true, ...resumo });
  });

  /* ----------------------- ADMIN: PEDIDOS ------------------------- */
  app.post("/admin/pedidos/:id/verificar-pagamento", verificarAdminBackend, async (req, res) => {
    const { data: pedido } = await supabase.from("pedidos").select("*").eq("id", Number(req.params.id)).maybeSingle();
    if (!pedido) return res.status(404).json({ sucesso: false, erro: "Pedido não encontrado." });
    if (!pedido.txid) return res.json({ sucesso: true, pago: pedido.status_pagamento === "pago", mensagem: "Pedido sem Pix." });
    const r = await conferirPagamentoPedido(supabase, consultarPix, pedido);
    if (r.falhou) return res.status(502).json({ sucesso: false, erro: "Não foi possível consultar o Sicredi agora." });
    return res.json({ sucesso: true, pago: r.pedido.status_pagamento === "pago", status_sicredi: r.statusSicredi });
  });

  app.post("/admin/pedidos/:id/reembolsar", verificarAdminBackend, async (req, res) => {
    const u = usuarioDaReq(req);
    const motivo = sanitizarTexto(req.body?.motivo, 300);
    if (!motivo) return res.status(400).json({ sucesso: false, erro: "Informe o motivo do reembolso." });
    const { data, error } = await supabase.rpc("fpss_reembolsar_pedido", {
      p_pedido_id: Number(req.params.id),
      p_motivo: motivo,
      p_usuario_nome: u.nome
    });
    if (error) return res.status(400).json({ sucesso: false, erro: mensagemErroSql(error, "Erro ao registrar reembolso.") });
    return res.json({ sucesso: true, resultado: data });
  });

  /* histórico completo de um pedido (itens + entregas) pro admin */
  app.get("/admin/pedidos/:id/detalhe", verificarAdminBackend, async (req, res) => {
    const { data: pedido } = await supabase.from("pedidos").select("*").eq("id", Number(req.params.id)).maybeSingle();
    if (!pedido) return res.status(404).json({ sucesso: false, erro: "Pedido não encontrado." });
    await anexarItens(supabase, pedido, { comEntregas: true });
    return res.json({ sucesso: true, pedido });
  });
}

module.exports = {
  TERMO_VERSAO,
  arred,
  montarItensDoCarrinho,
  criarPedidoComItens,
  resumoItensTexto,
  anexarItens,
  marcarPedidoComoPago,
  conferirPagamentoPedido,
  iniciarConferenciaAutomatica,
  registrarEntrega,
  registrarRotasVendas
};

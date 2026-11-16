/* =====================================================================
   EQUIPES DE VOLUNTÁRIOS — cadastro das equipes, líderes e pessoas
   (nome, nascimento, camiseta).

   Admin (tela "Equipes", chave "equipes"):
     GET    /admin/equipes
     POST   /admin/equipes                 PUT /admin/equipes/:id    DELETE /admin/equipes/:id
     POST   /admin/equipes/:id/renovar-link
     GET    /admin/equipes/:id/membros     POST /admin/equipes/:id/membros
     PUT    /admin/equipes/membros/:mid    DELETE /admin/equipes/membros/:mid
   Líder (sem login; o link secreto da equipe é a chave):
     GET    /api/equipe/:token
     POST   /api/equipe/:token/membros
     PUT    /api/equipe/:token/membros/:mid    DELETE idem
   Cronograma: GET/POST /admin/equipes/etapas, PUT/DELETE /admin/equipes/etapas/:id;
     líder: PUT/POST/DELETE /api/equipe/:token/etapas[/:id]
   Tabelas: equipes, equipes_membros (SQL 2026-11-16-equipes.sql), equipes_etapas (2026-11-17).
   Equipe com "proibe_menor" não aceita quem tem menos de 18 anos.
===================================================================== */

const TAMANHOS = ["Infantil 4", "Infantil 6", "Infantil 8", "Infantil 10", "Infantil 12", "Infantil 14",
  "PP", "P", "M", "G", "GG", "XG", "EXG", "Baby look P", "Baby look M", "Baby look G", "Baby look GG", "Sem camiseta"];

const txt = (v, max) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max || 100);
const fone = v => String(v ?? "").replace(/\D/g, "").slice(0, 13);
const inteiro = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? Math.min(n, 100000) : 0; };

function hojeRondonia() {
  return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}
function idadeEm(nascISO, hojeISO) {
  const [a, m, d] = String(nascISO).split("-").map(Number);
  const [ha, hm, hd] = String(hojeISO).split("-").map(Number);
  let i = ha - a;
  if (hm < m || (hm === m && hd < d)) i--;
  return i;
}
function dataValida(v) {
  const s = String(v || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const dt = new Date(s + "T12:00:00Z");
  if (isNaN(dt) || dt.toISOString().slice(0, 10) !== s) return null;
  if (s > hojeRondonia() || s < "1920-01-01") return null;
  return s;
}

/* valida e limpa os dados de uma pessoa; devolve { dados } ou { erro } */
function lerMembro(b, equipe) {
  const nome = txt(b.nome, 100);
  if (!nome) return { erro: "Informe o nome." };
  const nasc = dataValida(b.data_nascimento);
  if (!nasc) return { erro: "Informe uma data de nascimento válida." };
  const tam = txt(b.tamanho_camiseta, 20);
  if (!TAMANHOS.includes(tam)) return { erro: "Escolha o tamanho da camiseta." };
  const idade = idadeEm(nasc, hojeRondonia());
  if (equipe.proibe_menor && idade < 18) {
    return { erro: `A equipe ${equipe.nome} não aceita menor de 18 anos (esta pessoa tem ${idade}).` };
  }
  return { dados: { nome, data_nascimento: nasc, tamanho_camiseta: tam, telefone: fone(b.telefone) || null, endereco: txt(b.endereco, 200) || null } };
}

const zero = () => ({ cadastrados: 0, menores: 0, camisetas: {} });
function somar(mapa, chave, m) {
  const x = mapa.get(chave) || zero();
  x.cadastrados++; if (m.idade < 18) x.menores++;
  x.camisetas[m.tamanho_camiseta] = (x.camisetas[m.tamanho_camiseta] || 0) + 1;
  mapa.set(chave, x);
}
function lerGrupo(b) {
  return { nome: txt(b.nome, 60), previsto: inteiro(b.previsto), disponivel: inteiro(b.disponivel),
    ordem: Number.isFinite(Number(b.ordem)) ? Math.trunc(Number(b.ordem)) : 0 };
}

/* ---- cronograma: etapas da equipe ---- */
function horaValida(v) { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v || "").trim()); return m ? m[0] : null; }
function dataEtapa(v) {
  const s = String(v || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const dt = new Date(s + "T12:00:00Z");
  if (isNaN(dt) || dt.toISOString().slice(0, 10) !== s || s < "2026-01-01" || s > "2027-12-31") return null;
  return s;
}
function situacaoEtapa(t, hoje) {
  return t.realizada ? "realizada" : !t.data ? "sem_data" : t.data < hoje ? "atrasada" : "agendada";
}
/* campos que o líder (ou o admin) preenche */
function lerAgenda(b) {
  const bruto = String(b.data || "").trim();
  const data = bruto ? dataEtapa(bruto) : null;
  if (bruto && !data) return { erro: "Data inválida (use uma data entre 2026 e 2027)." };
  const horaBruta = String(b.hora || "").trim();
  const hora = horaBruta ? horaValida(horaBruta) : null;
  if (horaBruta && !hora) return { erro: "Horário inválido (use HH:MM)." };
  const pBruto = String(b.participantes ?? "").trim();
  const participantes = pBruto === "" ? null : (/^\d{1,5}$/.test(pBruto) ? parseInt(pBruto, 10) : NaN);
  if (Number.isNaN(participantes)) return { erro: "Informe a quantidade de participantes só com números." };
  return { dados: { data, hora, participantes, local: txt(b.local, 150) || null, observacao: txt(b.observacao, 300) || null, realizada: b.realizada === true || b.realizada === "true" } };
}

function registrarRotasEquipes(app, { supabase, exigirPagina, criarLimitador }) {
  const acesso = exigirPagina("equipes");
  const limitadorLider = criarLimitador({ janelaMs: 60 * 1000, max: 90 });
  const falha = (res, e, msg) => { console.error("[EQUIPES]", e?.message || e); return res.status(500).json({ sucesso: false, erro: msg }); };

  async function carregarMembros(equipeId) {
    const q = supabase.from("equipes_membros").select("id, equipe_id, grupo_id, nome, telefone, endereco, data_nascimento, tamanho_camiseta, created_at").order("nome");
    const { data, error } = equipeId ? await q.eq("equipe_id", equipeId) : await q;
    if (error) throw error;
    const hoje = hojeRondonia();
    return (data || []).map(m => ({ ...m, idade: idadeEm(m.data_nascimento, hoje) }));
  }

  /* ------------------------- ADMIN ------------------------- */
  /* ---- CRONOGRAMA (admin) ---- */
  async function carregarEtapas(equipeId) {
    const q = supabase.from("equipes_etapas").select("*").order("ordem").order("id");
    const { data, error } = equipeId ? await q.eq("equipe_id", equipeId) : await q;
    if (error) return [];     // SQL do cronograma ainda não rodou
    const hoje = hojeRondonia();
    return (data || []).map(t => ({ ...t, situacao: situacaoEtapa(t, hoje) }));
  }

  app.get("/admin/equipes/etapas", acesso, async (req, res) => {
    const teste = await supabase.from("equipes_etapas").select("id", { head: true, count: "exact" });
    if (teste.error) return res.status(500).json({ sucesso: false, erro: "O cronograma ainda não foi ativado no banco. Rode o SQL 2026-11-17-equipes-cronograma no Supabase." });
    const { data: eq } = await supabase.from("equipes").select("id, nome, lider_nome, lider_telefone, ativo, ordem");
    const mapa = new Map((eq || []).map(e => [e.id, e]));
    const etapas = (await carregarEtapas(null)).map(t => ({ ...t, equipe_nome: mapa.get(t.equipe_id)?.nome || "", lider_nome: mapa.get(t.equipe_id)?.lider_nome || "", equipe_ativa: mapa.get(t.equipe_id)?.ativo !== false }));
    res.json({ sucesso: true, etapas });
  });

  /* cria a etapa para UMA equipe (equipe_id) ou para TODAS as equipes ativas (todas: true) */
  app.post("/admin/equipes/etapas", acesso, async (req, res) => {
    const b = req.body || {};
    const titulo = txt(b.titulo, 100);
    if (!titulo) return res.status(400).json({ sucesso: false, erro: "Informe o nome da etapa." });
    const base = { titulo, descricao: txt(b.descricao, 300) || null, origem: "admin", ordem: Number(b.ordem) || 50 };
    let ids = [];
    if (b.todas === true || b.todas === "true") {
      const { data } = await supabase.from("equipes").select("id").eq("ativo", true);
      ids = (data || []).map(x => x.id);
    } else if (Array.isArray(b.equipe_ids)) {
      const pedidos = [...new Set(b.equipe_ids.map(Number).filter(Boolean))];
      const { data } = await supabase.from("equipes").select("id").in("id", pedidos);
      ids = (data || []).map(x => x.id);
    } else if (Number(b.equipe_id)) ids = [Number(b.equipe_id)];
    if (!ids.length) return res.status(400).json({ sucesso: false, erro: "Marque ao menos uma equipe." });
    const { data: jaTem } = await supabase.from("equipes_etapas").select("equipe_id").in("equipe_id", ids).ilike("titulo", titulo);
    const ja = new Set((jaTem || []).map(x => x.equipe_id));
    const novos = ids.filter(id => !ja.has(id)).map(id => ({ ...base, equipe_id: id }));
    if (!novos.length) return res.status(400).json({ sucesso: false, erro: "Essa etapa já existe nas equipes escolhidas." });
    const { error } = await supabase.from("equipes_etapas").insert(novos);
    if (error) return falha(res, error, "Não foi possível criar a etapa (rodou o SQL 2026-11-17-equipes-cronograma?).");
    res.json({ sucesso: true, criadas: novos.length });
  });

  app.put("/admin/equipes/etapas/:id", acesso, async (req, res) => {
    const b = req.body || {};
    const r = lerAgenda(b);
    if (r.erro) return res.status(400).json({ sucesso: false, erro: r.erro });
    const dados = { ...r.dados, realizada_em: r.dados.realizada ? new Date().toISOString() : null, updated_at: new Date().toISOString() };
    if (b.titulo !== undefined) { const t = txt(b.titulo, 100); if (!t) return res.status(400).json({ sucesso: false, erro: "Informe o nome da etapa." }); dados.titulo = t; }
    if (b.descricao !== undefined) dados.descricao = txt(b.descricao, 300) || null;
    const { error } = await supabase.from("equipes_etapas").update(dados).eq("id", Number(req.params.id));
    if (error) return falha(res, error, "Não foi possível salvar a etapa.");
    res.json({ sucesso: true });
  });

  app.delete("/admin/equipes/etapas/:id", acesso, async (req, res) => {
    const { error } = await supabase.from("equipes_etapas").delete().eq("id", Number(req.params.id));
    if (error) return falha(res, error, "Não foi possível excluir a etapa.");
    res.json({ sucesso: true });
  });

  async function carregarGrupos() {
    const { data, error } = await supabase.from("equipes_grupos").select("*").order("ordem").order("id");
    return error ? [] : (data || []);   // sem a tabela (SQL ainda não rodou): sem grupos
  }
  /* com funções, o previsto/disponível da equipe é a SOMA das funções (todo integrante tem função) */
  async function sincronizarTotais(equipeId) {
    const { data } = await supabase.from("equipes_grupos").select("previsto, disponivel").eq("equipe_id", equipeId);
    if (!data || !data.length) return;
    await supabase.from("equipes").update({ previsto: data.reduce((a, g) => a + g.previsto, 0), disponivel: data.reduce((a, g) => a + g.disponivel, 0) }).eq("id", equipeId);
  }
  async function equipeTemFuncoes(equipeId) {
    const { count } = await supabase.from("equipes_grupos").select("id", { count: "exact", head: true }).eq("equipe_id", equipeId);
    return count > 0;
  }
  /* grupo precisa ser da própria equipe; devolve o id, null (equipe principal) ou false (inválido) */
  async function grupoDaEquipe(equipeId, bruto) {
    const gid = Number(bruto) || null;
    if (!gid) return null;
    const { data } = await supabase.from("equipes_grupos").select("id").eq("id", gid).eq("equipe_id", equipeId).maybeSingle();
    return data ? data.id : false;
  }

  app.get("/admin/equipes", acesso, async (req, res) => {
    try {
      const { data: equipes, error } = await supabase.from("equipes").select("*").order("ordem").order("nome");
      if (error) throw error;
      const [membros, grupos, etapas] = [await carregarMembros(null), await carregarGrupos(), await carregarEtapas(null)];
      const porEt = new Map();
      etapas.forEach(t => { const x = porEt.get(t.equipe_id) || { et_total: 0, et_sem_data: 0, et_atrasadas: 0, et_agendadas: 0, et_realizadas: 0 };
        x.et_total++; if (t.situacao === "sem_data") x.et_sem_data++; else if (t.situacao === "atrasada") x.et_atrasadas++; else if (t.situacao === "agendada") x.et_agendadas++; else x.et_realizadas++; porEt.set(t.equipe_id, x); });
      const porEq = new Map(), porGr = new Map();
      membros.forEach(m => { somar(porEq, m.equipe_id, m); if (m.grupo_id) somar(porGr, m.grupo_id, m); });
      res.json({ sucesso: true, tamanhos: TAMANHOS,
        equipes: (equipes || []).map(e => {
          const gs = grupos.filter(g => g.equipe_id === e.id).map(g => ({ ...g, ...(porGr.get(g.id) || zero()) }));
          const tot = porEq.get(e.id) || zero();
          return { ...e, ...tot, ...(porEt.get(e.id) || { et_total: 0, et_sem_data: 0, et_atrasadas: 0, et_agendadas: 0, et_realizadas: 0 }), grupos: gs,
            cad_principal: tot.cadastrados - gs.reduce((a, g) => a + g.cadastrados, 0),
            /* o previsto da equipe é o TOTAL; as funções são parte dele e o resto são "integrantes" */
            previsto_total: gs.length ? gs.reduce((a, g) => a + g.previsto, 0) : e.previsto,
            disponivel_total: gs.length ? gs.reduce((a, g) => a + g.disponivel, 0) : e.disponivel,
            tem_funcoes: gs.length > 0 };
        }) });
    } catch (e) { falha(res, e, "Erro ao carregar as equipes (rodou o SQL 2026-11-16-equipes?)."); }
  });

  /* ---- grupos dentro da equipe (Frete, Auxiliar…) ---- */
  app.post("/admin/equipes/:id/grupos", acesso, async (req, res) => {
    const d = lerGrupo(req.body || {});
    if (!d.nome) return res.status(400).json({ sucesso: false, erro: "Informe o nome da função." });
    const { error } = await supabase.from("equipes_grupos").insert({ ...d, equipe_id: Number(req.params.id) });
    if (error) return falha(res, error, "Não foi possível criar a função (rodou o SQL 2026-11-16c-equipes-grupos?).");
    await sincronizarTotais(Number(req.params.id));
    res.json({ sucesso: true });
  });
  app.put("/admin/equipes/grupos/:gid", acesso, async (req, res) => {
    const d = lerGrupo(req.body || {});
    if (!d.nome) return res.status(400).json({ sucesso: false, erro: "Informe o nome da função." });
    const { data: g, error } = await supabase.from("equipes_grupos").update(d).eq("id", Number(req.params.gid)).select("equipe_id").maybeSingle();
    if (error) return falha(res, error, "Não foi possível salvar a função.");
    if (g) await sincronizarTotais(g.equipe_id);
    res.json({ sucesso: true });
  });
  app.delete("/admin/equipes/grupos/:gid", acesso, async (req, res) => {
    const gid = Number(req.params.gid);
    const { count } = await supabase.from("equipes_membros").select("id", { count: "exact", head: true }).eq("grupo_id", gid);
    if (count > 0) return res.status(400).json({ sucesso: false, erro: "Esta função tem pessoas cadastradas. Mude essas pessoas para outra função antes de excluir." });
    const { data: g, error } = await supabase.from("equipes_grupos").delete().eq("id", gid).select("equipe_id").maybeSingle();
    if (error) return falha(res, error, "Não foi possível excluir a função.");
    if (g) await sincronizarTotais(g.equipe_id);
    res.json({ sucesso: true });
  });

  function lerEquipe(b) {
    return {
      nome: txt(b.nome, 80), lider_nome: txt(b.lider_nome, 100) || null, lider_telefone: fone(b.lider_telefone) || null,
      previsto: inteiro(b.previsto), disponivel: inteiro(b.disponivel), proibe_menor: b.proibe_menor === true || b.proibe_menor === "true", fechada: b.fechada === true || b.fechada === "true",
      ativo: b.ativo === undefined ? true : (b.ativo === true || b.ativo === "true"), observacao: txt(b.observacao, 300) || null,
      ordem: Number.isFinite(Number(b.ordem)) ? Math.trunc(Number(b.ordem)) : 0
    };
  }

  app.post("/admin/equipes", acesso, async (req, res) => {
    const d = lerEquipe(req.body || {});
    if (!d.nome) return res.status(400).json({ sucesso: false, erro: "Informe o nome da equipe." });
    const { data, error } = await supabase.from("equipes").insert(d).select("*").single();
    if (error) return falha(res, error, "Não foi possível criar a equipe.");
    res.json({ sucesso: true, equipe: data });
  });

  app.put("/admin/equipes/:id", acesso, async (req, res) => {
    const id = Number(req.params.id);
    const d = lerEquipe(req.body || {});
    if (!d.nome) return res.status(400).json({ sucesso: false, erro: "Informe o nome da equipe." });
    if (d.proibe_menor) {
      const membros = await carregarMembros(id).catch(() => []);
      const menores = membros.filter(m => m.idade < 18).length;
      if (menores) return res.status(400).json({ sucesso: false, erro: `Há ${menores} menor(es) de 18 já cadastrado(s) nesta equipe. Remova-os antes de bloquear menores.` });
    }
    const { data, error } = await supabase.from("equipes").update(d).eq("id", id).select("*").single();
    if (error) return falha(res, error, "Não foi possível salvar a equipe.");
    await sincronizarTotais(id);
    res.json({ sucesso: true, equipe: data });
  });

  app.delete("/admin/equipes/:id", acesso, async (req, res) => {
    const id = Number(req.params.id);
    const { count } = await supabase.from("equipes_membros").select("id", { count: "exact", head: true }).eq("equipe_id", id);
    if (count > 0) return res.status(400).json({ sucesso: false, erro: "A equipe tem pessoas cadastradas. Para não perder o histórico, desative-a em vez de excluir." });
    const { error } = await supabase.from("equipes").delete().eq("id", id);
    if (error) return falha(res, error, "Não foi possível excluir.");
    res.json({ sucesso: true });
  });

  app.post("/admin/equipes/:id/renovar-link", acesso, async (req, res) => {
    const token = require("crypto").randomBytes(16).toString("hex");
    const { data, error } = await supabase.from("equipes").update({ token }).eq("id", Number(req.params.id)).select("id, token").single();
    if (error) return falha(res, error, "Não foi possível renovar o link.");
    res.json({ sucesso: true, token: data.token });
  });

  app.get("/admin/equipes/:id/membros", acesso, async (req, res) => {
    try { res.json({ sucesso: true, membros: await carregarMembros(Number(req.params.id)) }); }
    catch (e) { falha(res, e, "Erro ao carregar as pessoas."); }
  });

  async function equipePorId(id) {
    const { data } = await supabase.from("equipes").select("id, nome, proibe_menor, ativo").eq("id", id).maybeSingle();
    return data;
  }

  app.post("/admin/equipes/:id/membros", acesso, async (req, res) => {
    const eq = await equipePorId(Number(req.params.id));
    if (!eq) return res.status(404).json({ sucesso: false, erro: "Equipe não encontrada." });
    const r = lerMembro(req.body || {}, eq);
    if (r.erro) return res.status(400).json({ sucesso: false, erro: r.erro });
    const grupoId = await grupoDaEquipe(eq.id, (req.body || {}).grupo_id);
    if (grupoId === false) return res.status(400).json({ sucesso: false, erro: "Função inválida para esta equipe." });
    if (grupoId === null && await equipeTemFuncoes(eq.id)) return res.status(400).json({ sucesso: false, erro: "Escolha a função da pessoa na equipe." });
    const { error } = await supabase.from("equipes_membros").insert({ ...r.dados, grupo_id: grupoId, equipe_id: eq.id, origem: "admin" });
    if (error) return falha(res, error, "Não foi possível cadastrar.");
    res.json({ sucesso: true });
  });

  app.put("/admin/equipes/membros/:mid", acesso, async (req, res) => {
    const { data: m } = await supabase.from("equipes_membros").select("id, equipe_id").eq("id", Number(req.params.mid)).maybeSingle();
    if (!m) return res.status(404).json({ sucesso: false, erro: "Pessoa não encontrada." });
    const eq = await equipePorId(m.equipe_id);
    const r = lerMembro(req.body || {}, eq);
    if (r.erro) return res.status(400).json({ sucesso: false, erro: r.erro });
    const grupoId = await grupoDaEquipe(m.equipe_id, (req.body || {}).grupo_id);
    if (grupoId === false) return res.status(400).json({ sucesso: false, erro: "Função inválida para esta equipe." });
    if (grupoId === null && await equipeTemFuncoes(m.equipe_id)) return res.status(400).json({ sucesso: false, erro: "Escolha a função da pessoa na equipe." });
    const { error } = await supabase.from("equipes_membros").update({ ...r.dados, grupo_id: grupoId, updated_at: new Date().toISOString() }).eq("id", m.id);
    if (error) return falha(res, error, "Não foi possível salvar.");
    res.json({ sucesso: true });
  });

  app.delete("/admin/equipes/membros/:mid", acesso, async (req, res) => {
    const { error } = await supabase.from("equipes_membros").delete().eq("id", Number(req.params.mid));
    if (error) return falha(res, error, "Não foi possível excluir.");
    res.json({ sucesso: true });
  });

  /* ------------------------- LÍDER (link secreto) ------------------------- */
  async function equipeDoLink(req, res) {
    const token = String(req.params.token || "");
    if (!/^[a-f0-9]{32}$/.test(token)) { res.status(404).json({ sucesso: false, erro: "Link inválido." }); return null; }
    const { data } = await supabase.from("equipes").select("id, nome, lider_nome, previsto, proibe_menor, ativo").eq("token", token).maybeSingle();
    if (!data || !data.ativo) { res.status(404).json({ sucesso: false, erro: "Link inválido ou equipe desativada. Peça um link novo ao coordenador." }); return null; }
    return data;
  }

  app.get("/api/equipe/:token", limitadorLider, async (req, res) => {
    const eq = await equipeDoLink(req, res); if (!eq) return;
    try {
      const membros = await carregarMembros(eq.id);
      const gr = (await carregarGrupos()).filter(g => g.equipe_id === eq.id);
      const porGr = new Map(); membros.forEach(m => { if (m.grupo_id) somar(porGr, m.grupo_id, m); });
      const grupos = gr.map(g => ({ id: g.id, nome: g.nome, previsto: g.previsto, cadastrados: (porGr.get(g.id) || zero()).cadastrados }));
      const somaF = gr.reduce((a, g) => a + g.previsto, 0);
      const principal = { nome: gr.length ? "Sem função definida" : eq.nome, previsto: gr.length ? 0 : eq.previsto, cadastrados: membros.filter(m => !m.grupo_id).length };
      res.json({ sucesso: true, tamanhos: TAMANHOS, equipe: { nome: eq.nome, lider_nome: eq.lider_nome, previsto: gr.length ? somaF : eq.previsto, proibe_menor: eq.proibe_menor }, principal, grupos, membros, etapas: await carregarEtapas(eq.id), hoje: hojeRondonia() });
    } catch (e) { falha(res, e, "Erro ao carregar."); }
  });

  app.post("/api/equipe/:token/membros", limitadorLider, async (req, res) => {
    const eq = await equipeDoLink(req, res); if (!eq) return;
    const r = lerMembro(req.body || {}, eq);
    if (r.erro) return res.status(400).json({ sucesso: false, erro: r.erro });
    const grupoId = await grupoDaEquipe(eq.id, (req.body || {}).grupo_id);
    if (grupoId === false) return res.status(400).json({ sucesso: false, erro: "Função inválida." });
    if (grupoId === null && await equipeTemFuncoes(eq.id)) return res.status(400).json({ sucesso: false, erro: "Escolha a sua função na equipe." });
    const { error } = await supabase.from("equipes_membros").insert({ ...r.dados, grupo_id: grupoId, equipe_id: eq.id, origem: "lider" });
    if (error) return falha(res, error, "Não foi possível cadastrar.");
    res.json({ sucesso: true });
  });

  app.put("/api/equipe/:token/membros/:mid", limitadorLider, async (req, res) => {
    const eq = await equipeDoLink(req, res); if (!eq) return;
    const r = lerMembro(req.body || {}, eq);
    if (r.erro) return res.status(400).json({ sucesso: false, erro: r.erro });
    const grupoId = await grupoDaEquipe(eq.id, (req.body || {}).grupo_id);
    if (grupoId === false) return res.status(400).json({ sucesso: false, erro: "Função inválida." });
    if (grupoId === null && await equipeTemFuncoes(eq.id)) return res.status(400).json({ sucesso: false, erro: "Escolha a função da pessoa na equipe." });
    const { data, error } = await supabase.from("equipes_membros").update({ ...r.dados, grupo_id: grupoId, updated_at: new Date().toISOString() })
      .eq("id", Number(req.params.mid)).eq("equipe_id", eq.id).select("id");
    if (error) return falha(res, error, "Não foi possível salvar.");
    if (!data || !data.length) return res.status(404).json({ sucesso: false, erro: "Pessoa não encontrada nesta equipe." });
    res.json({ sucesso: true });
  });

  app.delete("/api/equipe/:token/membros/:mid", limitadorLider, async (req, res) => {
    const eq = await equipeDoLink(req, res); if (!eq) return;
    const { error } = await supabase.from("equipes_membros").delete().eq("id", Number(req.params.mid)).eq("equipe_id", eq.id);
    if (error) return falha(res, error, "Não foi possível excluir.");
    res.json({ sucesso: true });
  });

  /* ---- cronograma pelo link do líder ---- */
  app.put("/api/equipe/:token/etapas/:id", limitadorLider, async (req, res) => {
    const eq = await equipeDoLink(req, res); if (!eq) return;
    const b = req.body || {};
    const r = lerAgenda(b);
    if (r.erro) return res.status(400).json({ sucesso: false, erro: r.erro });
    const { data: et } = await supabase.from("equipes_etapas").select("id, origem").eq("id", Number(req.params.id)).eq("equipe_id", eq.id).maybeSingle();
    if (!et) return res.status(404).json({ sucesso: false, erro: "Etapa não encontrada nesta equipe." });
    const dados = { ...r.dados, realizada_em: r.dados.realizada ? new Date().toISOString() : null, updated_at: new Date().toISOString() };
    if (et.origem === "lider" && b.titulo !== undefined) { const t = txt(b.titulo, 100); if (t) dados.titulo = t; }
    const { error } = await supabase.from("equipes_etapas").update(dados).eq("id", et.id);
    if (error) return falha(res, error, "Não foi possível salvar.");
    res.json({ sucesso: true });
  });

  app.post("/api/equipe/:token/etapas", limitadorLider, async (req, res) => {
    const eq = await equipeDoLink(req, res); if (!eq) return;
    const b = req.body || {};
    const titulo = txt(b.titulo, 100);
    if (!titulo) return res.status(400).json({ sucesso: false, erro: "Informe o nome da etapa." });
    const r = lerAgenda(b);
    if (r.erro) return res.status(400).json({ sucesso: false, erro: r.erro });
    const { error } = await supabase.from("equipes_etapas").insert({ ...r.dados, equipe_id: eq.id, titulo, origem: "lider", ordem: 90,
      realizada_em: r.dados.realizada ? new Date().toISOString() : null });
    if (error) return falha(res, error, "Não foi possível cadastrar a etapa.");
    res.json({ sucesso: true });
  });

  app.delete("/api/equipe/:token/etapas/:id", limitadorLider, async (req, res) => {
    const eq = await equipeDoLink(req, res); if (!eq) return;
    const { data, error } = await supabase.from("equipes_etapas").delete().eq("id", Number(req.params.id)).eq("equipe_id", eq.id).eq("origem", "lider").select("id");
    if (error) return falha(res, error, "Não foi possível excluir.");
    if (!data || !data.length) return res.status(400).json({ sucesso: false, erro: "Só é possível excluir etapas criadas pela equipe." });
    res.json({ sucesso: true });
  });
}

module.exports = { registrarRotasEquipes };

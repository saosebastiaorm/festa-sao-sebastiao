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
   Tabelas: equipes, equipes_membros (SQL 2026-11-16-equipes.sql).
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

function registrarRotasEquipes(app, { supabase, exigirPagina, criarLimitador }) {
  const acesso = exigirPagina("equipes");
  const limitadorLider = criarLimitador({ janelaMs: 60 * 1000, max: 90 });
  const falha = (res, e, msg) => { console.error("[EQUIPES]", e?.message || e); return res.status(500).json({ sucesso: false, erro: msg }); };

  async function carregarMembros(equipeId) {
    const q = supabase.from("equipes_membros").select("id, equipe_id, nome, telefone, endereco, data_nascimento, tamanho_camiseta, created_at").order("nome");
    const { data, error } = equipeId ? await q.eq("equipe_id", equipeId) : await q;
    if (error) throw error;
    const hoje = hojeRondonia();
    return (data || []).map(m => ({ ...m, idade: idadeEm(m.data_nascimento, hoje) }));
  }

  /* ------------------------- ADMIN ------------------------- */
  app.get("/admin/equipes", acesso, async (req, res) => {
    try {
      const { data: equipes, error } = await supabase.from("equipes").select("*").order("ordem").order("nome");
      if (error) throw error;
      const membros = await carregarMembros(null);
      const por = new Map();
      membros.forEach(m => {
        const x = por.get(m.equipe_id) || { cadastrados: 0, menores: 0, camisetas: {} };
        x.cadastrados++; if (m.idade < 18) x.menores++;
        x.camisetas[m.tamanho_camiseta] = (x.camisetas[m.tamanho_camiseta] || 0) + 1;
        por.set(m.equipe_id, x);
      });
      res.json({ sucesso: true, tamanhos: TAMANHOS,
        equipes: (equipes || []).map(e => ({ ...e, ...(por.get(e.id) || { cadastrados: 0, menores: 0, camisetas: {} }) })) });
    } catch (e) { falha(res, e, "Erro ao carregar as equipes (rodou o SQL 2026-11-16-equipes?)."); }
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
    const { error } = await supabase.from("equipes_membros").insert({ ...r.dados, equipe_id: eq.id, origem: "admin" });
    if (error) return falha(res, error, "Não foi possível cadastrar.");
    res.json({ sucesso: true });
  });

  app.put("/admin/equipes/membros/:mid", acesso, async (req, res) => {
    const { data: m } = await supabase.from("equipes_membros").select("id, equipe_id").eq("id", Number(req.params.mid)).maybeSingle();
    if (!m) return res.status(404).json({ sucesso: false, erro: "Pessoa não encontrada." });
    const eq = await equipePorId(m.equipe_id);
    const r = lerMembro(req.body || {}, eq);
    if (r.erro) return res.status(400).json({ sucesso: false, erro: r.erro });
    const { error } = await supabase.from("equipes_membros").update({ ...r.dados, updated_at: new Date().toISOString() }).eq("id", m.id);
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
      res.json({ sucesso: true, tamanhos: TAMANHOS, equipe: { nome: eq.nome, lider_nome: eq.lider_nome, previsto: eq.previsto, proibe_menor: eq.proibe_menor }, membros });
    } catch (e) { falha(res, e, "Erro ao carregar."); }
  });

  app.post("/api/equipe/:token/membros", limitadorLider, async (req, res) => {
    const eq = await equipeDoLink(req, res); if (!eq) return;
    const r = lerMembro(req.body || {}, eq);
    if (r.erro) return res.status(400).json({ sucesso: false, erro: r.erro });
    const { error } = await supabase.from("equipes_membros").insert({ ...r.dados, equipe_id: eq.id, origem: "lider" });
    if (error) return falha(res, error, "Não foi possível cadastrar.");
    res.json({ sucesso: true });
  });

  app.put("/api/equipe/:token/membros/:mid", limitadorLider, async (req, res) => {
    const eq = await equipeDoLink(req, res); if (!eq) return;
    const r = lerMembro(req.body || {}, eq);
    if (r.erro) return res.status(400).json({ sucesso: false, erro: r.erro });
    const { data, error } = await supabase.from("equipes_membros").update({ ...r.dados, updated_at: new Date().toISOString() })
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
}

module.exports = { registrarRotasEquipes };

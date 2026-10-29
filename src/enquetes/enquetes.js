/* =====================================================
   ARQUIVO: src/enquetes/enquetes.js
   Telas do admin "Enquetes e Grupo VIP": só LEITURA.
   - GET /admin/enquetes  → respostas da enquete (tabela "enquetes")
   - GET /admin/vip       → cadastros do Grupo VIP (tabela "vip")
   Protegidas por exigirPagina("enquetes") (perfis de acesso).
===================================================== */
function registrarRotasEnquetes(app, { supabase, exigirPagina, criarLimitador }) {
  const acesso = exigirPagina("enquetes");
  const limite = criarLimitador ? criarLimitador({ janelaMs: 60 * 1000, max: 60 }) : (req, res, next) => next();

  /* o Supabase devolve no máximo 1000 linhas por consulta: lê em páginas */
  async function lerTudo(tabela) {
    const POR_PAGINA = 1000, MAX = 20000;
    let tudo = [];
    for (let de = 0; de < MAX; de += POR_PAGINA) {
      const { data, error } = await supabase.from(tabela).select("*").range(de, de + POR_PAGINA - 1);
      if (error) return { erro: error.message };
      tudo = tudo.concat(data || []);
      if (!data || data.length < POR_PAGINA) break;
    }
    const dt = r => new Date(r.created_at || r.criado_em || r.data || 0).getTime() || 0;
    tudo.sort((a, b) => (dt(b) - dt(a)) || ((Number(b.id) || 0) - (Number(a.id) || 0)));
    return { linhas: tudo };
  }

  app.get("/admin/enquetes", limite, acesso, async (req, res) => {
    const r = await lerTudo("enquetes");
    if (r.erro) { console.error("[ENQUETES]", r.erro); return res.status(500).json({ sucesso: false, erro: "Não foi possível ler as enquetes." }); }
    res.json({ sucesso: true, total: r.linhas.length, enquetes: r.linhas });
  });

  app.get("/admin/vip", limite, acesso, async (req, res) => {
    const r = await lerTudo("vip");
    if (r.erro) { console.error("[VIP]", r.erro); return res.status(500).json({ sucesso: false, erro: "Não foi possível ler os cadastros VIP." }); }
    res.json({ sucesso: true, total: r.linhas.length, vip: r.linhas });
  });
}

module.exports = { registrarRotasEnquetes };

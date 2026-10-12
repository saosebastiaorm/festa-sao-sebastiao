/* =====================================================================
   VENDEDORES DE CARTELA — cadastro de ambulantes e outras pessoas que
   vendem cartelas (tela "Vendedores de cartela", chave "vendedores").

     GET    /admin/vendedores?busca=&situacao=ativo|inativo
     POST   /admin/vendedores            (multipart: campos + 2 arquivos)
     PUT    /admin/vendedores/:id        (multipart; arquivo novo substitui o antigo)
     GET    /admin/vendedores/:id/arquivo/:tipo   → { url } (link que expira em 2 min)
     DELETE /admin/vendedores/:id        (apaga o cadastro e os documentos)

   Arquivos: bucket PRIVADO "vendedores-docs". Aceita JPG, PNG, WebP e PDF.
   Dados sensíveis (CPF, documentos): só quem tem a tela liberada no perfil.
===================================================================== */

const BUCKET = "vendedores-docs";
const TIPOS = { identificacao: "doc_identificacao_path", residencia: "comprovante_residencia_path" };
const ROTULO = { identificacao: "ident", residencia: "resid" };

function digitos(v) { return String(v ?? "").replace(/\D/g, ""); }

function detectarTipo(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "png";
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "webp";
  if (buf.slice(0, 4).toString("latin1") === "%PDF") return "pdf";
  return null;
}

function dataValida(v) {
  const s = String(v || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T12:00:00Z");
  if (isNaN(d) || d.toISOString().slice(0, 10) !== s) return null;
  if (d > new Date() || d.getUTCFullYear() < 1900) return null;
  return s;
}

function registrarRotasVendedores(app, { supabase, exigirPagina, criarLimitador, validarCPF, sanitizarTexto, multer, sharp }) {
  const acesso = exigirPagina("vendedores");
  const limitador = criarLimitador({ janelaMs: 10 * 60 * 1000, max: 120 });
  const envio = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 2 } })
    .fields([{ name: "identificacao", maxCount: 1 }, { name: "residencia", maxCount: 1 }]);

  function receber(req, res, next) {
    envio(req, res, err => {
      if (!err) return next();
      const grande = err.code === "LIMIT_FILE_SIZE";
      return res.status(400).json({ sucesso: false, erro: grande ? "Arquivo muito grande (máximo 10 MB)." : "Erro ao receber os arquivos." });
    });
  }

  /* campos de texto -> { erro } | { dados } */
  function montar(b) {
    const nome = sanitizarTexto(b.nome, 120);
    if (!nome || nome.length < 3) return { erro: "Informe o nome completo." };
    const cpf = digitos(b.cpf);
    if (!validarCPF(cpf)) return { erro: "CPF inválido." };
    let tel = digitos(b.telefone);
    if (tel.length > 11 && tel.startsWith("55")) tel = tel.slice(2);
    if (tel && (tel.length < 10 || tel.length > 11)) return { erro: "Telefone inválido (use DDD + número)." };
    const nasc = b.data_nascimento ? dataValida(b.data_nascimento) : null;
    if (b.data_nascimento && !nasc) return { erro: "Data de nascimento inválida." };
    const uf = String(b.uf || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
    const plano = parseInt(b.plano_id, 10);
    return { dados: {
      nome, cpf,
      data_nascimento: nasc,
      telefone: tel || null,
      endereco: sanitizarTexto(b.endereco, 200) || null,
      bairro: sanitizarTexto(b.bairro, 80) || null,
      cidade: sanitizarTexto(b.cidade, 80) || null,
      uf: uf || null,
      plano_id: plano > 0 ? plano : null,
      observacao: sanitizarTexto(b.observacao, 500) || null,
      ativo: !(b.ativo === false || b.ativo === "false")
    } };
  }

  /* guarda o arquivo no bucket privado; devolve o caminho */
  async function guardar(arquivo, tipo, idOuPasta) {
    const t = detectarTipo(arquivo.buffer);
    if (!t) { const e = new Error("Formato não aceito. Envie JPG, PNG, WebP ou PDF."); e.aviso = true; throw e; }
    let buffer = arquivo.buffer, ext = t, contentType = t === "pdf" ? "application/pdf" : "image/" + (t === "jpg" ? "jpeg" : t);
    if (t !== "pdf") {
      try {
        buffer = await sharp(arquivo.buffer).rotate().resize(1800, 1800, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
        ext = "jpg"; contentType = "image/jpeg";
      } catch (e) { const er = new Error("Não foi possível ler a imagem. Tente outra foto."); er.aviso = true; throw er; }
    }
    const caminho = `${idOuPasta}/${ROTULO[tipo]}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(caminho, buffer, { contentType, upsert: false });
    if (error) { console.error("[VENDEDORES] upload:", error.message); throw new Error("Não foi possível guardar o arquivo."); }
    return caminho;
  }
  async function apagar(caminhos) {
    const lista = caminhos.filter(Boolean);
    if (!lista.length) return;
    try { await supabase.storage.from(BUCKET).remove(lista); }
    catch (e) { console.error("[VENDEDORES] aviso: não apagou arquivo:", e.message); }
  }

  function publico(v, planos) {
    const { doc_identificacao_path, comprovante_residencia_path, ...resto } = v;
    return { ...resto, plano_nome: v.plano_id ? (planos[v.plano_id] || null) : null,
      tem_identificacao: !!doc_identificacao_path, tem_residencia: !!comprovante_residencia_path };
  }
  async function mapaPlanos() {
    const { data } = await supabase.from("blocos_planos").select("id,nome").order("ordem", { ascending: true });
    return { lista: data || [], mapa: Object.fromEntries((data || []).map(p => [p.id, p.nome])) };
  }

  app.get("/admin/vendedores", acesso, async (req, res) => {
    let q = supabase.from("vendedores_cartela").select("*").order("nome", { ascending: true }).limit(1000);
    if (req.query.situacao === "ativo") q = q.eq("ativo", true);
    if (req.query.situacao === "inativo") q = q.eq("ativo", false);
    const busca = String(req.query.busca || "").trim().slice(0, 60);
    if (busca) {
      const d = digitos(busca), t = busca.replace(/[,()%*]/g, " ").trim();
      const partes = [`nome.ilike.%${t}%`];
      if (d.length >= 3) { partes.push(`cpf.ilike.%${d}%`, `telefone.ilike.%${d}%`); }
      q = q.or(partes.join(","));
    }
    const { data, error } = await q;
    if (error) { console.error("[VENDEDORES] listar:", error.message); return res.status(500).json({ sucesso: false, erro: "Erro ao carregar os vendedores." }); }
    const pl = await mapaPlanos();
    return res.json({ sucesso: true, vendedores: (data || []).map(v => publico(v, pl.mapa)), planos: pl.lista });
  });

  app.post("/admin/vendedores", acesso, limitador, receber, async (req, res) => {
    const m = montar(req.body || {});
    if (m.erro) return res.status(400).json({ sucesso: false, erro: m.erro });
    const novos = [];
    try {
      const pasta = "novo-" + Date.now();
      const caminhos = {};
      for (const tipo of Object.keys(TIPOS)) {
        const f = req.files?.[tipo]?.[0];
        if (f) { caminhos[TIPOS[tipo]] = await guardar(f, tipo, pasta); novos.push(caminhos[TIPOS[tipo]]); }
      }
      const criador = req.nomeUsuario || req.usuarioAdmin?.email || null;
      const { data, error } = await supabase.from("vendedores_cartela").insert({ ...m.dados, ...caminhos, criado_por: criador }).select().single();
      if (error) {
        await apagar(novos);
        if (error.code === "23505") return res.status(409).json({ sucesso: false, erro: "Já existe um vendedor cadastrado com este CPF." });
        console.error("[VENDEDORES] inserir:", error.message);
        return res.status(500).json({ sucesso: false, erro: "Erro ao salvar o vendedor." });
      }
      const pl = await mapaPlanos();
      return res.json({ sucesso: true, vendedor: publico(data, pl.mapa) });
    } catch (e) {
      await apagar(novos);
      return res.status(e.aviso ? 400 : 500).json({ sucesso: false, erro: e.message });
    }
  });

  app.put("/admin/vendedores/:id", acesso, limitador, receber, async (req, res) => {
    const id = Number(req.params.id);
    const m = montar(req.body || {});
    if (m.erro) return res.status(400).json({ sucesso: false, erro: m.erro });
    const { data: atual } = await supabase.from("vendedores_cartela").select("*").eq("id", id).maybeSingle();
    if (!atual) return res.status(404).json({ sucesso: false, erro: "Vendedor não encontrado." });
    const novos = [], antigos = [];
    try {
      const caminhos = {};
      for (const tipo of Object.keys(TIPOS)) {
        const f = req.files?.[tipo]?.[0];
        if (f) {
          caminhos[TIPOS[tipo]] = await guardar(f, tipo, String(id)); novos.push(caminhos[TIPOS[tipo]]);
          antigos.push(atual[TIPOS[tipo]]);
        }
      }
      const { data, error } = await supabase.from("vendedores_cartela")
        .update({ ...m.dados, ...caminhos, updated_at: new Date().toISOString() }).eq("id", id).select().maybeSingle();
      if (error) {
        await apagar(novos);
        if (error.code === "23505") return res.status(409).json({ sucesso: false, erro: "Já existe outro vendedor com este CPF." });
        console.error("[VENDEDORES] atualizar:", error.message);
        return res.status(500).json({ sucesso: false, erro: "Erro ao salvar o vendedor." });
      }
      await apagar(antigos);
      const pl = await mapaPlanos();
      return res.json({ sucesso: true, vendedor: publico(data, pl.mapa) });
    } catch (e) {
      await apagar(novos);
      return res.status(e.aviso ? 400 : 500).json({ sucesso: false, erro: e.message });
    }
  });

  app.get("/admin/vendedores/:id/arquivo/:tipo", acesso, async (req, res) => {
    const col = TIPOS[req.params.tipo];
    if (!col) return res.status(400).json({ sucesso: false, erro: "Tipo de documento inválido." });
    const { data: v } = await supabase.from("vendedores_cartela").select(`id,${col}`).eq("id", Number(req.params.id)).maybeSingle();
    if (!v || !v[col]) return res.status(404).json({ sucesso: false, erro: "Documento não enviado." });
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(v[col], 120);
    if (error || !data?.signedUrl) return res.status(500).json({ sucesso: false, erro: "Não foi possível abrir o documento." });
    res.set("Cache-Control", "no-store");
    return res.json({ sucesso: true, url: data.signedUrl, pdf: /\.pdf$/i.test(v[col]) });
  });

  app.delete("/admin/vendedores/:id", acesso, async (req, res) => {
    const { data, error } = await supabase.from("vendedores_cartela").delete().eq("id", Number(req.params.id)).select().maybeSingle();
    if (error) { console.error("[VENDEDORES] excluir:", error.message); return res.status(500).json({ sucesso: false, erro: "Erro ao excluir." }); }
    if (!data) return res.status(404).json({ sucesso: false, erro: "Vendedor não encontrado." });
    await apagar([data.doc_identificacao_path, data.comprovante_residencia_path]);
    return res.json({ sucesso: true });
  });
}

module.exports = { registrarRotasVendedores };

/* =====================================================
   ARQUIVO: src/divulgacoes/divulgacoes.js
   "Minhas divulgações": a equipe cria mensagens com legenda + imagem
   ou vídeo. Cada uma ganha uma página pública (/d/<slug>) com prévia
   grande no WhatsApp (og:image 1200x630, og:video). Os envios um a um
   continuam na tela Contatos (a legenda + o link viram uma "mensagem").
   Rotas do admin: contatos (ver) e contatos_divulgacoes (criar/editar/excluir).
   Rota pública: GET /d/:slug (só lê).
===================================================== */
const multer = require("multer");
const sharp = require("sharp");
const crypto = require("crypto");

const BUCKET = "divulgacoes";
const SITE = "https://festasaosebastiao.com.br";
const MAX_VIDEO = 25 * 1024 * 1024;
const MAX_IMAGEM = 8 * 1024 * 1024;

function registrarRotasDivulgacoes(app, { supabase, exigirPagina, criarLimitador }) {
  const ver = exigirPagina("contatos");
  const editar = exigirPagina("contatos_divulgacoes");
  const limite = criarLimitador({ janelaMs: 60 * 1000, max: 60 });
  const limiteEscrita = criarLimitador({ janelaMs: 60 * 1000, max: 20 });
  const limitePublico = criarLimitador({ janelaMs: 60 * 1000, max: 240 });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VIDEO, files: 2 } })
    .fields([{ name: "midia", maxCount: 1 }, { name: "capa", maxCount: 1 }]);
  const receber = (req, res, next) => upload(req, res, err => {
    if (!err) return next();
    const grande = err.code === "LIMIT_FILE_SIZE";
    res.status(400).json({ sucesso: false, erro: grande ? "Arquivo grande demais (vídeo até 25 MB)." : "Não foi possível receber o arquivo." });
  });

  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const slugar = t => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "divulgacao";
  const novoSlug = t => `${slugar(t)}-${crypto.randomBytes(3).toString("hex")}`;
  const linkDe = slug => `${SITE}/d/${slug}`;
  const publicar = r => ({ ...r, link: linkDe(r.slug) });

  /* cartão 1200x630 (prévia grande do WhatsApp): fundo desfocado + arte inteira no centro (+ play no vídeo) */
  async function montarCartao(bufferImagem, comPlay) {
    const fundo = await sharp(bufferImagem).resize(1200, 630, { fit: "cover" }).blur(28).modulate({ brightness: 0.55 }).toBuffer();
    const frente = await sharp(bufferImagem).resize(1200, 630, { fit: "inside", withoutEnlargement: false }).toBuffer();
    const camadas = [{ input: frente, gravity: "center" }];
    if (comPlay) {
      const play = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
        <circle cx="600" cy="315" r="62" fill="rgba(0,0,0,0.62)"/>
        <polygon points="580,283 580,347 636,315" fill="#ffffff"/></svg>`);
      camadas.push({ input: play });
    }
    return sharp(fundo).composite(camadas).jpeg({ quality: 82 }).toBuffer();
  }

  /* cartão de marca quando o vídeo não trouxe capa */
  async function cartaoPadrao() {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b0000"/><stop offset="1" stop-color="#4d0000"/></linearGradient></defs>
      <rect width="1200" height="630" fill="url(#g)"/><rect width="1200" height="16" fill="#f2b705"/>
      <circle cx="600" cy="315" r="90" fill="rgba(0,0,0,0.45)"/><polygon points="570,265 570,365 655,315" fill="#ffffff"/></svg>`);
    return sharp(svg).jpeg({ quality: 82 }).toBuffer();
  }

  async function subir(caminho, buffer, tipo) {
    const { error } = await supabase.storage.from(BUCKET).upload(caminho, buffer, { contentType: tipo, upsert: true, cacheControl: "3600" });
    if (error) throw new Error(error.message);
    return supabase.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl;
  }
  async function apagarArquivos(caminhos) {
    const lista = caminhos.filter(Boolean);
    if (lista.length) await supabase.storage.from(BUCKET).remove(lista).catch(() => {});
  }

  /* ---------------- ADMIN ---------------- */
  app.get("/admin/divulgacoes", limite, ver, async (req, res) => {
    const { data, error } = await supabase.from("divulgacoes").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) {
      console.error("[DIVULGACOES] listar", error.message);
      return res.json({ sucesso: true, divulgacoes: [], aviso: "As divulgações ainda não estão ativas no servidor (rode o SQL 2026-11-24-divulgacoes.sql no Supabase)." });
    }
    res.json({ sucesso: true, divulgacoes: (data || []).map(publicar) });
  });

  app.post("/admin/divulgacoes", limiteEscrita, editar, receber, async (req, res) => {
    const novosArquivos = [];
    try {
      const titulo = String(req.body.titulo || "").trim().slice(0, 80);
      const legenda = String(req.body.legenda || "").trim().slice(0, 1500);
      const id = req.body.id ? Number(req.body.id) : null;
      const midia = req.files?.midia?.[0];
      const capa = req.files?.capa?.[0];
      if (!titulo) return res.status(400).json({ sucesso: false, erro: "Dê um título para a divulgação." });
      if (!legenda) return res.status(400).json({ sucesso: false, erro: "Escreva a legenda." });

      let atual = null;
      if (id) {
        const r = await supabase.from("divulgacoes").select("*").eq("id", id).maybeSingle();
        if (r.error || !r.data) return res.status(404).json({ sucesso: false, erro: "Divulgação não encontrada." });
        atual = r.data;
      }
      if (!atual && !midia) return res.status(400).json({ sucesso: false, erro: "Escolha a imagem ou o vídeo." });

      const campos = { titulo, legenda, atualizado_em: new Date().toISOString() };
      let apagar = [];

      if (midia) {
        const mime = String(midia.mimetype || "");
        const ehVideo = mime === "video/mp4";
        const ehImagem = /^image\/(jpeg|png|webp)$/.test(mime);
        if (!ehVideo && !ehImagem) return res.status(400).json({ sucesso: false, erro: "Use imagem (JPG, PNG, WEBP) ou vídeo em MP4." });
        if (ehImagem && midia.size > MAX_IMAGEM) return res.status(400).json({ sucesso: false, erro: "Imagem grande demais (até 8 MB)." });

        const slug = atual ? atual.slug : novoSlug(titulo);
        const v = Date.now().toString(36);
        let bufferMidia, tipoMidia, ext, bufferCartao;
        if (ehImagem) {
          bufferMidia = await sharp(midia.buffer).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer();
          tipoMidia = "image/jpeg"; ext = "jpg";
          bufferCartao = await montarCartao(bufferMidia, false);
        } else {
          bufferMidia = midia.buffer; tipoMidia = "video/mp4"; ext = "mp4";
          if (capa && /^image\//.test(capa.mimetype || "")) {
            const base = await sharp(capa.buffer).rotate().jpeg({ quality: 84 }).toBuffer();
            bufferCartao = await montarCartao(base, true);
          } else bufferCartao = await cartaoPadrao();
        }
        const caminhoMidia = `${slug}/midia-${v}.${ext}`, caminhoCartao = `${slug}/cartao-${v}.jpg`;
        campos.midia_url = await subir(caminhoMidia, bufferMidia, tipoMidia); novosArquivos.push(caminhoMidia);
        campos.og_url = await subir(caminhoCartao, bufferCartao, "image/jpeg"); novosArquivos.push(caminhoCartao);
        campos.midia_path = caminhoMidia; campos.og_path = caminhoCartao;
        campos.tipo = ehVideo ? "video" : "imagem";
        campos.slug = slug;
        if (atual) apagar = [atual.midia_path, atual.og_path];
      }

      let saida;
      if (atual) {
        saida = await supabase.from("divulgacoes").update(campos).eq("id", atual.id).select().single();
      } else {
        campos.criado_por = String(req.nomeUsuario || "").slice(0, 80) || null;
        saida = await supabase.from("divulgacoes").insert(campos).select().single();
      }
      if (saida.error) throw new Error(saida.error.message);
      await apagarArquivos(apagar);
      res.json({ sucesso: true, divulgacao: publicar(saida.data) });
    } catch (e) {
      console.error("[DIVULGACOES] salvar", e.message);
      await apagarArquivos(novosArquivos);
      res.status(500).json({ sucesso: false, erro: "Não foi possível salvar a divulgação. Confira se o SQL e a pasta de arquivos do Supabase foram criados." });
    }
  });

  app.delete("/admin/divulgacoes/:id", limiteEscrita, editar, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ sucesso: false, erro: "Divulgação inválida." });
    const r = await supabase.from("divulgacoes").select("midia_path, og_path").eq("id", id).maybeSingle();
    if (r.error || !r.data) return res.status(404).json({ sucesso: false, erro: "Divulgação não encontrada." });
    const del = await supabase.from("divulgacoes").delete().eq("id", id);
    if (del.error) return res.status(500).json({ sucesso: false, erro: "Não foi possível excluir." });
    await apagarArquivos([r.data.midia_path, r.data.og_path]);
    res.json({ sucesso: true });
  });

  /* ---------------- PÁGINA PÚBLICA (lida pelo WhatsApp e pelas pessoas) ---------------- */
  function legendaHtml(texto) {
    let t = esc(String(texto || "").replace(/\{nome\}/gi, "").replace(/(Olá|Oi),\s*!/g, "$1!"));
    t = t.replace(/\*([^*\n]+)\*/g, "<b>$1</b>");
    t = t.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="noopener">$1</a>');
    return t.replace(/\n/g, "<br>");
  }
  function descricaoCurta(texto) {
    const t = String(texto || "").replace(/\{nome\}/gi, "").replace(/https?:\/\/\S+/g, "").replace(/\*/g, "")
      .replace(/\s+/g, " ").replace(/(Olá|Oi),\s*!/g, "$1!").trim();
    return t.length > 190 ? t.slice(0, 187) + "..." : t;
  }

  app.get("/d/:slug", limitePublico, async (req, res) => {
    const slug = String(req.params.slug || "").toLowerCase();
    let d = null;
    if (/^[a-z0-9-]{3,60}$/.test(slug)) {
      const r = await supabase.from("divulgacoes").select("*").eq("slug", slug).maybeSingle();
      d = r.data || null;
    }
    res.set("Cache-Control", "public, max-age=60");
    res.set("Content-Type", "text/html; charset=utf-8");
    if (!d) {
      return res.status(404).send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex"><title>Divulgação não encontrada</title></head><body style="font-family:Arial,sans-serif;text-align:center;padding:40px 16px"><h1>Divulgação não encontrada</h1><p><a href="${SITE}/">Ir para o site da festa</a></p></body></html>`);
    }
    const url = linkDe(d.slug), titulo = esc(d.titulo), desc = esc(descricaoCurta(d.legenda)), ehVideo = d.tipo === "video";
    const midia = ehVideo
      ? `<video controls playsinline preload="metadata" poster="${esc(d.og_url)}"><source src="${esc(d.midia_url)}" type="video/mp4">Seu aparelho não conseguiu abrir o vídeo.</video>`
      : `<img class="arte" src="${esc(d.midia_url)}" alt="${titulo}">`;
    res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${titulo} | 6ª FPSS</title>
<meta name="description" content="${desc}">
<meta name="robots" content="noindex">
<meta property="og:type" content="${ehVideo ? "video.other" : "website"}">
<meta property="og:site_name" content="6ª FPSS 2027">
<meta property="og:title" content="${titulo}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(d.og_url)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
${ehVideo ? `<meta property="og:video" content="${esc(d.midia_url)}">
<meta property="og:video:secure_url" content="${esc(d.midia_url)}">
<meta property="og:video:type" content="video/mp4">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#8b0000">
<link rel="icon" href="${SITE}/assets/icons/favicon.png">
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:Roboto,Arial,sans-serif;background:#fdf6ec;color:#3a1a1a}
  header{background:#8b0000;color:#fff;text-align:center;padding:14px 16px;font-weight:800;font-size:17px}
  main{max-width:520px;margin:0 auto;padding:18px 16px 40px;text-align:center}
  h1{font-size:23px;line-height:1.25;color:#8b0000;margin:14px 0 8px}
  .arte,video{width:100%;max-height:80vh;border-radius:16px;background:#000;box-shadow:0 8px 24px rgba(0,0,0,.28);margin:4px 0 8px;object-fit:contain}
  .leg{font-size:16px;line-height:1.55;margin:12px 0;text-align:left;word-break:break-word}
  .leg a{color:#8b0000}
  .btn{display:block;background:#8b0000;color:#fff;text-decoration:none;font-weight:800;font-size:18px;padding:15px;border-radius:14px;margin:14px 0 8px}
</style>
</head>
<body>
<header>6ª Festa do Padroeiro São Sebastião</header>
<main>
  <h1>${titulo}</h1>
  ${midia}
  <div class="leg">${legendaHtml(d.legenda)}</div>
  <a class="btn" href="${SITE}/">Ir para o site da festa</a>
</main>
</body>
</html>`);
  });
}

module.exports = { registrarRotasDivulgacoes };

const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { gerarCartelaDigitalPNG } = require("./src/services/cartelas/gerar-cartela-digital");
const { gerarVersoCartelaPNG } = require("./src/services/cartelas/gerar-verso-cartela");
const { uploadCartelaDigital } = require("./src/services/cartelas/upload-cartela-storage");
const { buscarLoteAtivo, valorEmReais } = require("./src/services/cartelas/lotes");
const { normalizarNumeroDigitado } = require("./src/services/cartelas/dv");
const { processarPlanilha } = require("./src/services/cartelas/importar-lote");
const vendas = require("./src/vendas/vendas");
const { registrarRotasBlocos } = require("./src/blocos/blocos");
const sharp = require("sharp");
require("dotenv").config();


const { createClient } = require("@supabase/supabase-js");

const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

/* =====================================================
   SICREDI
===================================================== */

const {
  getAccessToken
} = require("./src/services/sicredi/auth");

const {
  criarPix
} = require("./src/services/sicredi/pix");

const {
  consultarPix
} = require("./src/services/sicredi/consultarPix");

const app = express();

/* O Render fica atrás de um proxy: sem isso, o limitador de requisições
   enxerga o IP do proxy (igual pra todo mundo) em vez do IP real de quem
   acessa. */
app.set("trust proxy", 1);

/* Sem isso, um erro que escapa de todo try/catch (ou uma promise rejeitada
   sem .catch) derruba o processo Node inteiro — o Render reinicia sozinho,
   mas isso tira TODO MUNDO do ar até o restart terminar. Loga e mantém o
   processo de pé; o ideal a longo prazo é sempre tratar o erro na origem,
   isso aqui é uma rede de segurança, não substitui os try/catch. */
process.on("uncaughtException", (erro) => {
  console.error("[ERROR] ERRO NÃO TRATADO (uncaughtException):", erro);
});
process.on("unhandledRejection", (erro) => {
  console.error("[ERROR] PROMISE REJEITADA SEM CATCH (unhandledRejection):", erro);
});

/* Headers de segurança (Helmet) + remove o header que revela a stack.
   CSP desligado aqui: quem serve HTML é o frontend (Vercel), que já tem
   sua própria CSP em vercel.json — esta API só responde JSON, então uma
   CSP genérica do Helmet não se aplica e só atrapalharia. */
app.use(helmet({ contentSecurityPolicy: false }));
app.disable("x-powered-by");

/* =====================================================
   CORS MASTER
===================================================== */

const allowedOrigins = [
  "https://festasaosebastiao.com.br",
  "https://www.festasaosebastiao.com.br",

  "https://festa-sao-sebastiao.vercel.app",
  "https://festa-sao-sebastiao-5qrm0ce5e-saosebastiaorm.vercel.app",

  "http://localhost:5500",
  "http://127.0.0.1:5500",

  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

/* Preview deploys do próprio projeto no Vercel seguem esse padrão de nome
   (festa-sao-sebastiao-<hash>-saosebastiaorm.vercel.app) — troca do
   "origin.includes('vercel.app')" antigo, que aceitava QUALQUER site
   hospedado no Vercel, não só os deploys deste projeto. */
const origemVercelDoProjeto = /^https:\/\/festa-sao-sebastiao-[a-z0-9-]+-saosebastiaorm\.vercel\.app$/;

app.use(cors({
  origin: function (origin, callback) {

    if (!origin) return callback(null, true);

    if (
      allowedOrigins.includes(origin) ||
      origemVercelDoProjeto.test(origin)
    ) {
      return callback(null, true);
    }

    return callback(new Error("Origem não permitida pelo CORS"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.options(/.*/, cors());

/* =====================================================
   RATE LIMITING (rotas sensíveis: login, criação/consulta de Pix, admin)
   Resposta em JSON, no mesmo formato "sucesso:false" usado pelo resto da
   API, pra não quebrar nenhum tratamento de erro já existente no front.
===================================================== */
function criarLimitador(opcoes) {
  return rateLimit({
    windowMs: opcoes.janelaMs,
    limit: opcoes.max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(opcoes.keyGenerator ? { keyGenerator: opcoes.keyGenerator } : {}),
    message: { sucesso: false, erro: "Muitas tentativas. Aguarde um pouco e tente de novo." },
  });
}

/* Na festa, os ~15 caixas e a equipe saem pela MESMA internet (mesmo IP).
   Contar por IP bloquearia a equipe inteira; quem está logado é contado
   pelo próprio login (token), visitantes continuam contados por IP. */
const crypto = require("crypto");
function chavePorLoginOuIp(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Bearer ") && auth.length > 20) {
    return "tok:" + crypto.createHash("sha256").update(auth).digest("hex").slice(0, 24);
  }
  return rateLimit.ipKeyGenerator(req.ip || "");
}

const limitadorLoginCliente = criarLimitador({ janelaMs: 15 * 60 * 1000, max: 8 });
const limitadorPix = criarLimitador({ janelaMs: 5 * 60 * 1000, max: 20 });
const limitadorAdmin = criarLimitador({ janelaMs: 60 * 1000, max: 120, keyGenerator: chavePorLoginOuIp });
/* Caixa/retirada: cada operador tem o próprio limite (bem folgado). */
const limitadorOperador = criarLimitador({ janelaMs: 60 * 1000, max: 300, keyGenerator: chavePorLoginOuIp });
/* Rotas de "verificar-pagamento" são consultadas pelo PRÓPRIO navegador
   do comprador a cada 5s enquanto ele espera o Pix confirmar (pode durar
   vários minutos) — um limite apertado aqui bloquearia pagamento
   legítimo. Limite bem mais folgado, só pra conter abuso real. */
const limitadorPolling = criarLimitador({ janelaMs: 5 * 60 * 1000, max: 120 });

/* Aplicado a toda rota /admin/* de uma vez, antes da checagem de login —
   protege tanto tentativas autenticadas quanto tentativas de adivinhar
   token, sem precisar repetir o limitador em cada uma das rotas admin. */
app.use("/admin", limitadorAdmin);

/* =====================================================
   BODY + ARQUIVOS ESTÁTICOS
===================================================== */
app.use(express.json({ limit: "10mb" }));


/* =====================================================
   SUPABASE
===================================================== */
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error("[ERROR] ERRO: Credenciais Supabase ausentes.");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/* =====================================================
   MIDDLEWARE DE ACESSO ADMIN — PERFIS DE ACESSO
   Confere se quem chama a rota é um usuário autenticado e se o
   perfil dele pode abrir aquela tela. Usa a service_role key
   (SUPABASE_KEY) pra validar o token e consultar o perfil.

   Papéis (user_profiles.role):
     admin       → tudo, sempre (inclusive Usuários e os perfis)
     padrao      → só as telas marcadas para "Padrão"
     voluntario  → só as telas marcadas para "Voluntário"
   As telas de cada perfil ficam na tabela perfis_acesso e o
   administrador marca/desmarca na tela Usuários → Perfis de acesso.
   Usuários (e a própria configuração dos perfis) é sempre só admin,
   pra ninguém conseguir se dar mais acesso.

   Definido logo no topo (antes de qualquer rota) porque "const"
   não é hoisted.
===================================================== */
const PAGINAS_ADMIN = [
  { chave: "central",   nome: "Admin Central",            pagina: "/admin/dashboard.html" },
  { chave: "dashboard", nome: "Dashboard",                pagina: "/admin/dashboard-metricas.html" },
  { chave: "pedidos",   nome: "Pedidos",                  pagina: "/admin/pedidos.html" },
  { chave: "reembolso", nome: "Pedidos — reembolsar",     pagina: null },
  { chave: "cartelas",  nome: "Cartelas",                 pagina: "/admin/cartelas.html" },
  { chave: "blocos",    nome: "Blocos (distribuição)",    pagina: "/admin/blocos.html" },
  { chave: "caixa",     nome: "Caixa (vender)",           pagina: "/admin/caixa.html" },
  { chave: "caixas",    nome: "Caixas (conferência)",     pagina: "/admin/caixas.html" },
  { chave: "retirada",  nome: "Retirada",                 pagina: "/admin/retirada.html" },
  { chave: "leitor",    nome: "Leitor",                   pagina: "/admin/leitor.html" },
  { chave: "produtos",  nome: "Produtos (preço e estoque)", pagina: "/admin/produtos.html" },
  { chave: "parceiros", nome: "Parceiros",                pagina: "/admin/parceiros.html" },
  { chave: "lotes",     nome: "Lotes de cartelas",        pagina: "/admin/lotes.html" }
];
const CHAVES_PAGINAS = PAGINAS_ADMIN.map(p => p.chave);
const PAPEIS_EQUIPE = ["padrao", "voluntario"];
const PAPEIS_VALIDOS = ["admin", ...PAPEIS_EQUIPE];

/* Se o SQL dos perfis ainda não foi rodado, mantém o acesso antigo
   da equipe (Caixa, Retirada e Leitor) — nunca libera a mais. */
const PERFIS_SEM_TABELA = {
  padrao: ["caixa", "retirada", "leitor"],
  voluntario: ["caixa", "retirada", "leitor"]
};

let cachePerfis = { em: 0, dados: null };

function limparCachePerfis() {
  cachePerfis = { em: 0, dados: null };
}

async function lerPerfisAcesso() {
  if (cachePerfis.dados && Date.now() - cachePerfis.em < 30000) return cachePerfis.dados;
  const { data, error } = await supabase.from("perfis_acesso").select("papel,paginas");
  let dados;
  if (error) {
    console.error("[ACESSO] perfis_acesso indisponível (rodou o SQL 2026-10-05b?):", error.message);
    dados = PERFIS_SEM_TABELA;
  } else {
    dados = { padrao: [], voluntario: [] };
    (data || []).forEach(r => {
      if (PAPEIS_EQUIPE.includes(r.papel)) {
        dados[r.papel] = (r.paginas || []).filter(k => CHAVES_PAGINAS.includes(k));
      }
    });
  }
  cachePerfis = { em: Date.now(), dados };
  return dados;
}

/* telas liberadas para um usuário (perfil + "acesso_blocos" individual) */
async function paginasDoUsuario(perfil) {
  if (!perfil) return [];
  if (perfil.role === "admin") return CHAVES_PAGINAS.slice();
  if (!PAPEIS_EQUIPE.includes(perfil.role)) return [];
  const perfis = await lerPerfisAcesso();
  const lista = (perfis[perfil.role] || []).slice();
  if (perfil.acesso_blocos === true && !lista.includes("blocos")) lista.push("blocos");
  return lista;
}

/* Fábrica de verificador.
   paginas = []          → só administrador
   paginas = ["a","b"]   → admin ou quem tem qualquer uma dessas telas
   paginas = "*"         → qualquer usuário da equipe logado (admin, padrão, voluntário) */
function criarVerificadorDeAcesso(paginas) {
  return async function (req, res, next) {

    try {

      const authHeader = req.headers.authorization || "";
      const token = authHeader.replace("Bearer ", "").trim();

      if (!token) {
        return res.status(401).json({
          sucesso: false,
          erro: "Sessão não encontrada. Faça login novamente."
        });
      }

      const { data: userData, error: userError } =
        await supabase.auth.getUser(token);

      if (userError || !userData || !userData.user) {
        return res.status(401).json({
          sucesso: false,
          erro: "Sessão inválida ou expirada. Faça login novamente."
        });
      }

      const { data: perfil, error: perfilError } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("id", userData.user.id)
        .single();

      if (perfilError || !perfil || !PAPEIS_VALIDOS.includes(perfil.role)) {
        return res.status(403).json({
          sucesso: false,
          erro: "Acesso restrito."
        });
      }

      const liberadas = await paginasDoUsuario(perfil);
      const admin = perfil.role === "admin";
      const permitido = admin ||
        paginas === "*" ||
        (Array.isArray(paginas) && paginas.some(p => liberadas.includes(p)));

      if (!permitido) {
        return res.status(403).json({
          sucesso: false,
          erro: "Seu perfil não tem acesso a esta função. Peça a um administrador."
        });
      }

      req.usuarioAdmin = userData.user;
      req.papelUsuario = perfil.role;
      req.nomeUsuario = perfil.nome || userData.user.email;
      req.paginasUsuario = liberadas;
      next();

    } catch (erro) {

      console.error("[ADMIN] ERRO VERIFICAR ACESSO BACKEND:", erro);

      return res.status(500).json({
        sucesso: false,
        erro: "Erro interno ao verificar permissão."
      });

    }
  };

}

function exigirPagina(...paginas) {
  return criarVerificadorDeAcesso(paginas);
}

const verificarAdminBackend = criarVerificadorDeAcesso([]);
const verificarEquipeLogada = criarVerificadorDeAcesso("*");
const verificarAcessoRetirada = exigirPagina("retirada", "leitor");
const verificarAcessoCaixa = exigirPagina("caixa");

/* =====================================================
   TESTE TOKEN SICREDI
===================================================== */


app.get("/sicredi/token", limitadorAdmin, async (req, res) => {

  try {

    const token = await getAccessToken();

    return res.json({
      sucesso: true,
      access_token: token
    });

  } catch (error) {

    console.error("[PIX] ERRO SICREDI:");

    if (error.response) {

      console.error(error.response.status);
      console.error(error.response.data);

      return res.status(500).json({
        sucesso: false,
        erro: error.response.data
      });

    }

    console.error(error.message);

    return res.status(500).json({
      sucesso: false,
      erro: error.message
    });

  }

});



/* =====================================================
   FUNÇÕES AUXILIARES
===================================================== */
function limparCPF(cpf) {
  return String(cpf || "").replace(/\D/g, "");
}

function limparTelefone(telefone) {
  return String(telefone || "").replace(/\D/g, "");
}

function validarCPF(cpf) {
  cpf = cpf.replace(/\D/g, "");

  if (cpf.length !== 11) return false;

  if (/^(\d)\1+$/.test(cpf)) return false;

  let soma = 0;

  for (let i = 0; i < 9; i++) {
    soma += parseInt(cpf.charAt(i)) * (10 - i);
  }

  let resto = (soma * 10) % 11;

  if (resto === 10 || resto === 11) {
    resto = 0;
  }

  if (resto !== parseInt(cpf.charAt(9))) {
    return false;
  }

  soma = 0;

  for (let i = 0; i < 10; i++) {
    soma += parseInt(cpf.charAt(i)) * (11 - i);
  }

  resto = (soma * 10) % 11;

  if (resto === 10 || resto === 11) {
    resto = 0;
  }

  if (resto !== parseInt(cpf.charAt(10))) {
    return false;
  }

  return true;
}

/* Remove os caracteres que servem pra montar HTML/script (<, >) de campos
   de texto livre digitados pelo comprador (nome, sobrenome...) antes de
   gravar no banco — defesa em profundidade junto com o escape no
   front-end: mesmo que uma tela esqueça de escapar na hora de exibir, o
   dado já chega limpo. Não mexe em acentos/pontuação normal. */
function sanitizarTexto(valor, tamanhoMaximo = 200) {
  return String(valor || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, tamanhoMaximo);
}

/* Código de pedido só deve ter letras/números/hífen — qualquer coisa fora
   disso não é um código válido de verdade, então é mais seguro rejeitar
   do que tentar sanitizar. */
function codigoPedidoValido(valor) {
  return /^[A-Za-z0-9-]{1,50}$/.test(String(valor || ""));
}

/* =====================================================
   STATUS
===================================================== */
app.get("/", (req, res) => {
  res.json({
    status: "online",
    sistema: "FPSS PRODUÇÃO PROFISSIONAL",
    ambiente: process.env.NODE_ENV || "development"
  });
});

/* =====================================================
   MONITORAMENTO — /health e /ready
   /health: o processo Node está de pé e respondendo (liveness) — não
   depende de nada externo, então nunca falha por causa do Supabase
   estar fora do ar. Uso: ping simples de "o servidor caiu?".
   /ready: além de estar de pé, as dependências essenciais respondem
   (readiness) — usado antes de mandar tráfego real pro processo (ex.:
   healthcheck do Render, ou um load balancer futuro).
===================================================== */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString()
  });
});

app.get("/ready", async (req, res) => {

  const variaveisEssenciais = ["SUPABASE_URL", "SUPABASE_KEY"];
  const faltando = variaveisEssenciais.filter((v) => !process.env[v]);

  let bancoOk = false;
  let erroBanco = null;

  try {
    const { error } = await supabase.from("cartelas_config").select("chave").limit(1);
    bancoOk = !error;
    if (error) erroBanco = error.message;
  } catch (erro) {
    erroBanco = erro.message;
  }

  const pronto = bancoOk && faltando.length === 0;

  res.status(pronto ? 200 : 503).json({
    status: pronto ? "ok" : "not_ready",
    database: bancoOk ? "ok" : "erro",
    erro_database: erroBanco || undefined,
    variaveis_ausentes: faltando.length ? faltando : undefined,
    timestamp: new Date().toISOString()
  });
});

/* =====================================================
   LINK COM PRÉVIA BONITA (Open Graph) PRA IMAGEM DIRETA
   O WhatsApp (e a maioria dos apps) monta o card de prévia de um
   link lendo as tags og:title/og:image da página — pra um link
   direto de imagem (sem HTML), ele só tem o domínio pra mostrar,
   o que fica feio (ex: "dzhgawgzrpgmyopptiwl.supabase.co"). Essa
   rota serve uma página mínima com essas tags preenchidas, então o
   card de prévia mostra um título legível + miniatura da cartela
   em vez do nome do domínio. Quem abre o link de verdade (humano,
   não o crawler de prévia) é redirecionado pra imagem na hora.

   Só aceita imagens do nosso próprio bucket público do Storage —
   não é um redirecionador aberto pra qualquer URL.
===================================================== */
const PREFIXO_STORAGE_PUBLICO =
  new URL(process.env.SUPABASE_URL).origin + "/storage/v1/object/public/";

function escaparHtml(texto) {
  return String(texto || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

app.get("/link-imagem", (req, res) => {

  const img = String(req.query.img || "");
  const titulo = String(req.query.titulo || "Cartela FPSS").slice(0, 200);

  if (!img.startsWith(PREFIXO_STORAGE_PUBLICO)) {
    return res.status(400).send("Link inválido.");
  }

  const tituloSeguro = escaparHtml(titulo);
  const imgSeguro = escaparHtml(img);

  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${tituloSeguro}</title>
<meta property="og:title" content="${tituloSeguro}">
<meta property="og:image" content="${imgSeguro}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${imgSeguro}">
</head>
<body>
<p><a href="${imgSeguro}">Ver imagem</a></p>
</body>
</html>`);
});

/* =====================================================
   API STATUS
===================================================== */
app.get("/api", (req, res) => {

  res.json({

    status: "API ONLINE",

    sistema: "FPSS BACKEND",

    ambiente: process.env.NODE_ENV || "development",

    rotas: {

      status: "/",

      api: "/api",

      config_produto: "/produto/:codigo",

      criar_pix: "/criar-pix",

      verificar_pagamento: "/verificar-pagamento/:txid",

      consultar_txid: "/pedido/:orderId",

      buscar_codigo: "/pedido/codigo/:codigoPedido",

      buscar_cpf: "/pedido/cpf/:cpf",

      confirmar_retirada: "/retirada/:codigoPedido",

      admin_dashboard: "/admin/dashboard",

      admin_pedidos: "/admin/pedidos",

      cliente_login: "/cliente-login"

    }

  });

});

/* =====================================================
   CONFIG PREÇO CHURRASCO
===================================================== */


/* =====================================================
   CRIAR PIX + REGISTRAR PEDIDO
===================================================== */
app.post("/criar-pix", limitadorPix, async (req, res) => {
  try {
    const {
      nome: nomeBruto,
      sobrenome: sobrenomeBruto,
      cpf,
      telefone,
      email,
      horario_retirada,
      termo_aceito,
      quantidade,
      produto_codigo
    } = req.body || {};

    const nome = sanitizarTexto(nomeBruto, 100);
    const sobrenome = sanitizarTexto(sobrenomeBruto, 100);
    const cpfLimpo = limparCPF(cpf);
    const telefoneLimpo = limparTelefone(telefone);

    if (!nome) {
      return res.status(400).json({ sucesso: false, erro: "Informe o nome." });
    }

    if (!validarCPF(cpfLimpo)) {
      return res.status(400).json({ sucesso: false, erro: "CPF inválido." });
    }

    /* Formato novo: itens = [{codigo, quantidade}, ...] (lista de compras).
       Formato antigo (1 produto): produto_codigo + quantidade — aceito
       pra não quebrar quem estiver com a página antiga aberta. */
    const formatoNovo = Array.isArray(req.body?.itens);
    const itensBrutos = formatoNovo
      ? req.body.itens
      : [{ codigo: produto_codigo, quantidade: quantidade || 1 }];

    if (formatoNovo && termo_aceito !== true) {
      return res.status(400).json({
        sucesso: false,
        erro: "É preciso aceitar as condições de retirada para continuar."
      });
    }

    const montagem = await vendas.montarItensDoCarrinho(supabase, itensBrutos);
    if (montagem.erro) {
      return res.status(montagem.status || 400).json({
        sucesso: false,
        erro: montagem.erro,
        esgotado: montagem.esgotado
      });
    }

    const { itens, total, quantidadeTotal } = montagem;

    if (!(total > 0)) {
      return res.status(400).json({ sucesso: false, erro: "Total inválido." });
    }

    /* Horário previsto POR PRODUTO (só produtos com "exige_horario", ex.:
       churrasco). Página antiga mandava um horário só pro pedido inteiro:
       nesse caso ele vale para todos esses produtos. */
    const horarioGeral = /^\d{2}:\d{2}$/.test(String(horario_retirada || "").trim())
      ? String(horario_retirada).trim()
      : null;
    for (const item of itens) {
      if (item.exige_horario && !item.horario_retirada) item.horario_retirada = horarioGeral;
    }
    const semHorario = itens.find(i => i.exige_horario && !i.horario_retirada);
    if (semHorario) {
      return res.status(400).json({
        sucesso: false,
        erro: `Selecione o horário previsto para retirar: ${semHorario.produto_nome}.`
      });
    }
    const itensComHorario = itens.filter(i => i.exige_horario);
    const exigeHorario = itensComHorario.length > 0;
    const horario = !exigeHorario
      ? null
      : itensComHorario.length === 1
        ? itensComHorario[0].horario_retirada
        : itensComHorario.map(i => `${i.produto_nome} ${i.horario_retirada}`).join(" · ");

    /* SICREDI PIX (valor calculado aqui, com os preços do banco) */
    const cobranca = await criarPix(total, `${nome} ${sobrenome || ""}`.trim(), cpfLimpo);

    if (!cobranca || !cobranca.txid) {
      return res.status(502).json({ sucesso: false, erro: "Não foi possível gerar o Pix agora. Tente novamente." });
    }

    const prefixo = itens.length === 1 ? itens[0].produto_codigo : "P";

    const criado = await vendas.criarPedidoComItens(supabase, {
      nome,
      sobrenome: sobrenome || "",
      cpf: cpfLimpo,
      telefone: telefoneLimpo || "nao informado",
      email: email ? sanitizarTexto(email, 150) : null,
      produto_tipo: itens.length === 1 ? itens[0].produto_codigo : "MIX",
      quantidade: quantidadeTotal,
      valor_unitario: itens.length === 1 ? itens[0].preco_unitario : null,
      horario_retirada: exigeHorario ? horario : null,
      valor_total: total,
      txid: cobranca.txid,
      pix_copia_cola: cobranca.pixCopiaECola || null,
      status_pagamento: "pendente",
      status_retirada: "pendente",
      status: "pendente",
      origem: "site",
      forma_pagamento: "pix",
      termo_aceito_em: termo_aceito === true ? new Date().toISOString() : null,
      termo_versao: termo_aceito === true ? vendas.TERMO_VERSAO : null
    }, itens, prefixo, [{ forma: "pix", valor: total }]);

    if (criado.erro) {
      return res.status(500).json({ sucesso: false, erro: "Erro ao salvar pedido." });
    }

    const resumo = vendas.resumoItensTexto(itens);

    return res.status(200).json({
      sucesso: true,
      mensagem: "PIX gerado com sucesso.",
      txid: cobranca.txid,
      codigo_pedido: criado.codigo_pedido,
      itens: itens.map(i => ({
        codigo: i.produto_codigo,
        nome: i.produto_nome,
        quantidade: i.quantidade,
        preco_unitario: i.preco_unitario,
        imagem: i.imagem,
        exige_horario: i.exige_horario,
        horario_retirada: i.horario_retirada || null
      })),
      horario_retirada: exigeHorario ? horario : null,

      /* campos do formato antigo (telas que mostram 1 produto) */
      produto_tipo: itens.length === 1 ? itens[0].produto_codigo : "MIX",
      produto_codigo: itens.length === 1 ? itens[0].produto_codigo : "MIX",
      produto_nome: itens.length === 1 ? itens[0].produto_nome : resumo,
      produto_imagem: itens[0].imagem,
      produto_descricao: itens.length === 1 ? itens[0].descricao : resumo,
      produto_preco_unitario: itens.length === 1 ? itens[0].preco_unitario : total,
      quantidade: quantidadeTotal,
      total,
      pix_copia_cola: cobranca.pixCopiaECola,
      qr_code_base64: cobranca.qrCodeBase64
    });

  } catch (erro) {
    console.error("[PIX] ERRO AO GERAR PIX:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao gerar PIX."
    });
  }
});


/* =====================================================
   ROTA VIP INTEGRADA (SEM ERROS DE CAMINHO OU 404)
===================================================== */
/* =====================================================
   ROTA VIP - CORRIGIDA E AUDITADA
===================================================== */
app.post("/api/vip", async (req, res) => {
  try {
    const { nome, whatsapp, cidade, bairro } = req.body;

    if (!nome || !whatsapp || !cidade || !bairro) {
      return res.status(400).json({
        sucesso: false,
        erro: "Todos os campos são obrigatórios."
      });
    }

    const payload = {
      nome: String(nome).trim(),
      whatsapp: String(whatsapp).trim(),
      cidade: String(cidade).trim(),
      bairro: String(bairro).trim(),
      origem: "VIP"
    };

    const { data, error } = await supabase
      .from("vip")
      .insert([payload]);

    if (error) {
      console.error("[PEDIDO] Erro interno Supabase VIP:", error);

      return res.status(500).json({
        sucesso: false,
        erro: error.message
      });
    }

    return res.status(200).json({
      sucesso: true,
      mensagem: "Cadastro VIP realizado com sucesso!"
    });

  } catch (erro) {
    console.error("[PEDIDO] Erro crítico na rota VIP:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno no servidor."
    });
  }
});


/* =====================================================
   VERIFICAR PAGAMENTO 
===================================================== */
app.get("/verificar-pagamento/:txid", limitadorPolling, async (req, res) => {
  try {
    const { txid } = req.params;

    if (!/^[A-Za-z0-9]{1,40}$/.test(String(txid || ""))) {
      return res.status(400).json({ sucesso: false, erro: "Identificador inválido." });
    }

    const { data: pedido, error: pedidoError } = await supabase
      .from("pedidos")
      .select("*")
      .eq("txid", txid)
      .maybeSingle();

    if (pedidoError || !pedido) {
      return res.status(404).json({ sucesso: false, erro: "Pedido não encontrado." });
    }

    /* confere no Sicredi; se pago, marca como pago e baixa o estoque
       (uma única vez, mesmo que essa rota seja chamada várias vezes) */
    const r = await vendas.conferirPagamentoPedido(supabase, consultarPix, pedido);

    if (r.falhou) {
      return res.status(502).json({ sucesso: false, erro: "Erro ao verificar pagamento." });
    }

    const atualizado = r.pedido;

    if (atualizado.status_pagamento === "pago") {
      return res.json({
        sucesso: true,
        txid,
        status: "CONCLUIDA",
        status_interno: "pago",
        created_at: atualizado.created_at,
        updated_at: new Date().toISOString(),
        data_pagamento: atualizado.data_pagamento || new Date().toISOString(),
        token_retirada: atualizado.token_retirada,
        qr_code_retirada: atualizado.qr_code_retirada,
        status_retirada: atualizado.status_retirada
      });
    }

    return res.json({
      sucesso: true,
      txid,
      status: r.statusSicredi,
      status_interno: atualizado.status_pagamento === "cancelado" ? "cancelado" : "pendente"
    });

  } catch (erro) {
    console.error("[PIX] Erro verificar pagamento:", erro);
    return res.status(500).json({ sucesso: false, erro: "Erro ao verificar pagamento." });
  }
});

/* =====================================================
   RECUPERAR PIX DE PEDIDOS ANTIGOS
===================================================== */
app.get("/recuperar-pix/:txid", async (req, res) => {

    try {

        const { txid } = req.params;

        const pagamento = await consultarPix(txid);

        return res.json({

            sucesso: true,

            txid,

            pix_copia_cola:
                pagamento.pixCopiaECola || null,



        });

    } catch (erro) {

        console.error(
            "[PIX] ERRO RECUPERAR PIX:",
            erro.response?.data || erro.message
        );

        return res.status(500).json({

            sucesso: false,

            erro: erro.message

        });

    }

});


/* =====================================================
   CONSULTAR POR PAYMENT ID
===================================================== */
/* Pedido pra tela de retirada: itens + histórico de entregas. Se o Pix
   ainda está pendente, confere no Sicredi antes (cliente pode ter pago
   e fechado a página). */
async function prepararPedidoRetirada(pedido) {
  let atual = pedido;
  if (atual.status_pagamento !== "pago" && atual.txid && !atual.reembolsado_em && atual.status !== "cancelado") {
    const r = await vendas.conferirPagamentoPedido(supabase, consultarPix, atual);
    atual = r.pedido;
  }
  await vendas.anexarItens(supabase, atual, { comEntregas: true });
  return atual;
}

app.get("/pedido/:orderId", verificarAcessoRetirada, limitadorOperador, async (req, res) => {
  try {
    const { orderId } = req.params;

    const { data, error } = await supabase
      .from("pedidos")
      .select("*")
      .eq("txid", orderId)
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({ sucesso: false, erro: "Pedido não encontrado." });
    }

    return res.json({ sucesso: true, pedido: await prepararPedidoRetirada(data) });

  } catch (erro) {
    return res.status(500).json({ sucesso: false, erro: "Erro ao consultar pedido." });
  }
});

/* =====================================================
   CONSULTAR POR CÓDIGO OFICIAL
===================================================== */
app.get("/pedido/codigo/:codigoPedido", verificarAcessoRetirada, limitadorOperador, async (req, res) => {
  try {
    const codigoPedido = String(req.params.codigoPedido || "").trim().toUpperCase();

    if (!codigoPedidoValido(codigoPedido)) {
      return res.status(400).json({ sucesso: false, erro: "Código de pedido inválido." });
    }

    const { data, error } = await supabase
      .from("pedidos")
      .select("*")
      .eq("codigo_pedido", codigoPedido)
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({ sucesso: false, erro: "Código não encontrado." });
    }

    return res.json({ sucesso: true, pedido: await prepararPedidoRetirada(data) });

  } catch (erro) {
    return res.status(500).json({ sucesso: false, erro: "Erro ao buscar código." });
  }
});

/* =====================================================
   CONSULTAR POR CPF
===================================================== */
app.get("/pedido/cpf/:cpf", verificarAcessoRetirada, limitadorOperador, async (req, res) => {
  try {

    const cpf = limparCPF(req.params.cpf);

    const { data, error } = await supabase
      .from("pedidos")
      .select("*")
      .eq("cpf", cpf)
      .order("id", { ascending: false });

    if (error || !data || !data.length) {
      return res.status(404).json({ sucesso: false, erro: "CPF não encontrado." });
    }

    await vendas.anexarItens(supabase, data);

    return res.json({ sucesso: true, pedidos: data, total: data.length });

  } catch (erro) {
    return res.status(500).json({ sucesso: false, erro: "Erro ao buscar CPF." });
  }
});

/* =====================================================
   CONFIRMAR RETIRADA (total ou parcial)
   body.itens = [{ item_id, quantidade }]  -> entrega só isso
   sem body.itens                          -> entrega tudo que falta
===================================================== */
app.post("/retirada/:codigoPedido", verificarAcessoRetirada, limitadorOperador, async (req, res) => {
  try {
    const codigoPedido = String(req.params.codigoPedido || "").trim().toUpperCase();

    if (!codigoPedidoValido(codigoPedido)) {
      return res.status(400).json({ sucesso: false, erro: "Código de pedido inválido." });
    }

    const { data: pedido, error: pedidoError } = await supabase
      .from("pedidos")
      .select("*")
      .eq("codigo_pedido", codigoPedido)
      .maybeSingle();

    if (pedidoError || !pedido) {
      return res.status(404).json({ sucesso: false, erro: "Pedido não encontrado." });
    }

    if (pedido.reembolsado_em) {
      return res.status(400).json({ sucesso: false, erro: "Pedido reembolsado. Entrega bloqueada." });
    }

    if (pedido.status_pagamento !== "pago") {
      return res.status(400).json({ sucesso: false, erro: "Pagamento ainda não confirmado." });
    }

    if (pedido.status_retirada === "retirado") {
      return res.status(400).json({ sucesso: false, erro: "Pedido já retirado." });
    }

    const r = await vendas.registrarEntrega(
      supabase,
      pedido,
      req.body?.itens,
      { id: req.usuarioAdmin?.id, nome: req.nomeUsuario },
      "retirada"
    );

    if (r.erro) {
      return res.status(400).json({ sucesso: false, erro: r.erro });
    }

    const { data: atualizado } = await supabase
      .from("pedidos").select("*").eq("id", pedido.id).single();
    await vendas.anexarItens(supabase, atualizado, { comEntregas: true });

    return res.json({
      sucesso: true,
      mensagem: r.resultado.status_retirada === "retirado"
        ? "Entrega concluída — pedido totalmente retirado."
        : "Entrega parcial registrada.",
      resultado: r.resultado,
      pedido: atualizado
    });

  } catch (erro) {
    console.error("[RETIRADA] erro:", erro);
    return res.status(500).json({ sucesso: false, erro: "Erro interno." });
  }
});

/* =====================================================
   DASHBOARD ADMIN
===================================================== */
app.get("/admin/dashboard", exigirPagina("dashboard"), async (req, res) => {
  try {
    const { data: pedidos, error } = await supabase
      .from("pedidos")
      .select("*");

    if (error) {
      return res.status(500).json({
        sucesso: false,
        erro: "Erro ao carregar dashboard."
      });
    }

    const totalPedidos = pedidos.length;

    const pagos = pedidos.filter(p => p.status_pagamento === "pago");
    const pendentes = pedidos.filter(p => p.status_pagamento !== "pago");
    const retirados = pedidos.filter(p => p.status_retirada === "retirado");

    const receitaTotal = pedidos.reduce(
      (acc, p) => acc + Number(p.valor_total || 0),
      0
    );

    const receitaConfirmada = pagos.reduce(
      (acc, p) => acc + Number(p.valor_total || 0),
      0
    );

    const totalItensVendidos = pedidos.reduce(
      (acc, p) => acc + Number(p.quantidade || 0),
      0
    );

    const totalItensRetirados = retirados.reduce(
      (acc, p) => acc + Number(p.quantidade || 0),
      0
    );

    return res.json({
      sucesso: true,
      total_pedidos: totalPedidos,
      total_pago: pagos.length,
      total_pendente: pendentes.length,
      total_retirado: retirados.length,
      itens_vendidos: totalItensVendidos,
      itens_retirados: totalItensRetirados,
      receita_total: receitaTotal,
      receita_confirmada: receitaConfirmada
    });

  } catch (erro) {
    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno dashboard."
    });
  }
});

/* =====================================================
   LISTA ADMIN PEDIDOS
===================================================== */
app.get("/admin/pedidos", exigirPagina("pedidos"), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("pedidos")
      .select("*")
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({
        sucesso: false,
        erro: "Erro ao carregar pedidos."
      });
    }

    await vendas.anexarItens(supabase, data);

    return res.json({
      sucesso: true,
      total: data.length,
      pedidos: data
    });

  } catch (erro) {
    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno."
    });
  }
});



/* =====================================================
   PRODUTOS - LISTAR TODOS ATIVOS
===================================================== */
app.get("/produtos", async (req, res) => {
  try {

    const { data, error } = await supabase
      .from("produtos")
      .select("id,codigo,nome,descricao,preco,ativo,estoque,tipo,imagem,ordem,exige_horario")
      .eq("ativo", true)
      .order("ordem", { ascending: true });

    if (error) {
      return res.status(500).json({
        sucesso: false,
        erro: "Erro ao carregar produtos."
      });
    }

    const produtosPublicos = (data || []).map(p => ({
      ...p,
      disponivel: Math.max(Number(p.estoque || 0), 0),
      esgotado: Number(p.estoque || 0) <= 0
    }));

    return res.json({
      sucesso: true,
      total: produtosPublicos.length,
      produtos: produtosPublicos
    });

  } catch (erro) {

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao listar produtos."
    });
  }
});

/* =====================================================
   PRODUTO - BUSCAR POR CÓDIGO
===================================================== */
app.get("/produto/:codigo", async (req, res) => {
  try {

 
const codigo =
    String(req.params.codigo || "")
        .trim()
        .toUpperCase();
    const { data, error } = await supabase
      .from("produtos")
      .select("*")
      .eq("codigo", codigo)
      .single();

    if (error || !data) {
      return res.status(404).json({
        sucesso: false,
        erro: "Produto não encontrado."
      });
    }

    return res.json({
      sucesso: true,
      produto: data
    });

  } catch (erro) {

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao buscar produto."
    });
  }
});

/* =====================================================
   ADMIN PRODUTOS - LISTAR TODOS
===================================================== */
app.get("/admin/produtos", exigirPagina("produtos"), async (req, res) => {
  try {

    const { data, error } = await supabase
      .from("produtos")
      .select("*")
      .order("ordem", { ascending: true });

    if (error) {
      return res.status(500).json({
        sucesso: false,
        erro: "Erro ao carregar painel de produtos."
      });
    }

    return res.json({
      sucesso: true,
      total: data.length,
      produtos: data
    });

  } catch (erro) {

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno admin produtos."
    });
  }
});

/* =====================================================
   ADMIN PRODUTOS - ATUALIZAR
===================================================== */
/* =====================================================
   ADMIN PRODUTOS - CRIAR / ATUALIZAR
===================================================== */
app.post("/admin/produtos", exigirPagina("produtos"), async (req, res) => {
  
  try {

    const {
      id,
      codigo,
      nome,
      descricao,
      preco,
      ativo,
      estoque,
      tipo,
      imagem,
      ordem,
      exige_horario,
      estoque_minimo
    } = req.body || {};

    if (!codigo || !nome) {
      return res.status(400).json({
        sucesso: false,
        erro: "Código e nome são obrigatórios."
      });
    }

    const codigoNormalizado = String(codigo).trim().toUpperCase();

    const produtoData = {
      codigo: codigoNormalizado,
      nome: String(nome).trim(),
      descricao: descricao ? String(descricao).trim() : null,
      preco: Number(preco || 0),
      ativo: ativo === true,
      tipo: tipo ? String(tipo).trim() : "produto",
      imagem: imagem ? String(imagem).trim() : null,
      ordem: Number(ordem || 0),
      updated_at: new Date().toISOString()
    };

    if (exige_horario !== undefined) produtoData.exige_horario = exige_horario === true || exige_horario === "true";
    if (estoque_minimo !== undefined && estoque_minimo !== "") produtoData.estoque_minimo = Math.max(Number(estoque_minimo) || 0, 0);

    /* Estoque NÃO é mais sobrescrito pela edição do produto: depois de
       criado, só muda por Entrada/Saída/Ajuste (tela de Estoque) e pelas
       vendas/entregas — assim fica tudo registrado no histórico. Só no
       cadastro de um produto NOVO o valor informado vira o saldo inicial. */
    const estoqueInicial = Math.max(Number(estoque || 0), 0);

    let resultado;

    /* =========================================
       CAMINHO 1 — EDIÇÃO COM ID CONHECIDO
       Se o frontend mandou o id do produto (tela de
       edição), o UPDATE é feito direto por id. Isso
       evita o bug antigo: se o código fosse alterado
       durante a edição, a busca por "codigo" não achava
       o produto original e criava um duplicado novo,
       deixando o antigo intacto.
    ========================================= */
    if (id) {

      resultado = await supabase
        .from("produtos")
        .update(produtoData)
        .eq("id", id)
        .select();

    } else {

      /* =========================================
         CAMINHO 2 — SEM ID (fluxo antigo, produto novo)
         Continua buscando por "codigo" pra decidir entre
         update/insert, mantendo compatibilidade com
         qualquer chamada antiga que não envie id.
      ========================================= */
      const { data: existente, error: buscaErro } = await supabase
        .from("produtos")
        .select("id")
        .eq("codigo", codigoNormalizado)
        .limit(1);

      if (buscaErro) {
        console.error("[PEDIDO] ERRO BUSCA PRODUTO:", buscaErro);

        return res.status(500).json({
          sucesso: false,
          erro: buscaErro.message || "Erro ao verificar produto."
        });
      }

      const produtoExistente =
        existente && existente.length > 0
          ? existente[0]
          : null;

      if (produtoExistente) {

        resultado = await supabase
          .from("produtos")
          .update(produtoData)
          .eq("codigo", codigoNormalizado)
          .select();

      } else {

        resultado = await supabase
          .from("produtos")
          .insert([
            {
              ...produtoData,
              estoque: estoqueInicial,
              estoque_fisico: estoqueInicial,
              created_at: new Date().toISOString()
            }
          ])
          .select();

        if (!resultado.error && resultado.data && resultado.data[0]) {
          await supabase.from("estoque_movimentos").insert([{
            produto_id: resultado.data[0].id,
            tipo: "inicial",
            delta_disponivel: estoqueInicial,
            delta_fisico: estoqueInicial,
            disponivel_apos: estoqueInicial,
            fisico_apos: estoqueInicial,
            motivo: "Cadastro do produto",
            usuario_id: req.usuarioAdmin?.id || null,
            usuario_nome: req.nomeUsuario || null
          }]);
        }
      }

    }

if (!resultado || resultado.error) {

  console.error("[PEDIDO] ERRO SALVAR PRODUTO:", resultado?.error || resultado);

  return res.status(500).json({
    sucesso: false,
    erro: resultado?.error?.message || "Erro ao salvar produto."
  });
}

    return res.json({
      sucesso: true,
      mensagem: "Produto salvo com sucesso.",
      produto: resultado.data
    });

  } catch (erro) {

  console.error("[ADMIN] ERRO INTERNO ADMIN PRODUTOS DETALHADO:", erro);

  return res.status(500).json({
    sucesso: false,
    erro: erro.message || JSON.stringify(erro)
  });
}
});

/* =====================================================
   ADMIN PRODUTOS - EXCLUIR
===================================================== */
app.delete("/admin/produtos/:id", exigirPagina("produtos"), async (req, res) => {

  try {

    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        sucesso: false,
        erro: "ID do produto é obrigatório."
      });
    }

    /* =========================================
       1. BUSCA A IMAGEM DO PRODUTO ANTES DE APAGAR
    ========================================= */
    const { data: produtoExistente, error: erroBusca } = await supabase
      .from("produtos")
      .select("imagem")
      .eq("id", id)
      .maybeSingle();

    if (erroBusca) {
      console.error("[PEDIDO] ERRO AO BUSCAR PRODUTO PARA EXCLUSÃO:", erroBusca);
      // não interrompe — segue tentando excluir mesmo sem confirmar a imagem
    }

    /* =========================================
       2. APAGA A LINHA DO BANCO
    ========================================= */
    const { error } = await supabase
      .from("produtos")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[PEDIDO] ERRO EXCLUIR PRODUTO:", error);

      return res.status(500).json({
        sucesso: false,
        erro: error.message || "Erro ao excluir produto."
      });
    }

    /* =========================================
       3. APAGA O ARQUIVO DE IMAGEM NO STORAGE
       (best-effort: se falhar, não desfaz a exclusão do produto,
       só registra no log do servidor pra acompanhamento)
    ========================================= */
    if (produtoExistente && produtoExistente.imagem) {
      try {
        const urlImagem = produtoExistente.imagem;
        const nomeArquivo = urlImagem.split("/produtos/").pop();

        if (nomeArquivo) {
          const { error: erroStorage } = await supabase.storage
            .from("produtos")
            .remove([nomeArquivo]);

          if (erroStorage) {
            console.error(`[PEDIDO] AVISO: produto ${id} excluído, mas falhou ao remover imagem "${nomeArquivo}" do Storage:`, erroStorage.message);
          } else {
            console.log(`[PEDIDO] Imagem "${nomeArquivo}" removida do Storage junto com o produto ${id}.`);
          }
        }
      } catch (erroParse) {
        console.error(`[PEDIDO] AVISO: não foi possível interpretar a URL da imagem do produto ${id} para limpeza do Storage:`, erroParse.message);
      }
    }

    return res.json({
      sucesso: true,
      mensagem: "Produto excluído com sucesso."
    });

  } catch (erro) {

    console.error("[PEDIDO] ERRO INTERNO EXCLUIR PRODUTO:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: erro.message || "Erro interno ao excluir produto."
    });

  }

});

   


/* =====================================================
   ADMIN UPLOAD IMAGEM PRODUTO
===================================================== */
app.post("/admin/upload-imagem", exigirPagina("produtos"), upload.single("imagem"), async (req, res) => {
  try {

    if (!req.file) {
      return res.status(400).json({
        sucesso: false,
        erro: "Nenhuma imagem enviada."
      });
    }

    const nomeArquivo =
      (req.body.nomeArquivo || `produto-${Date.now()}`)
        .replace(/[^a-zA-Z0-9-_]/g, "_");

    // Sempre salva como .webp, independente do formato original enviado
    const caminhoArquivo = `${nomeArquivo}.webp`;

    // Otimiza: redimensiona (máx. 1200px no lado maior, sem esticar
    // imagens menores) e converte para WebP qualidade 80
    const bufferOtimizado = await sharp(req.file.buffer)
      .resize(1200, 1200, {
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: 80 })
      .toBuffer();

    const { error: uploadError } = await supabase.storage
      .from("produtos")
      .upload(caminhoArquivo, bufferOtimizado, {
        contentType: "image/webp",
        upsert: true
      });

    if (uploadError) {
      console.error("[PEDIDO] ERRO UPLOAD:", uploadError);

      return res.status(500).json({
        sucesso: false,
        erro: uploadError.message
      });
    }

    const { data } = supabase.storage
      .from("produtos")
      .getPublicUrl(caminhoArquivo);

    return res.json({
      sucesso: true,
      mensagem: "Imagem enviada com sucesso.",
      imagem_url: data.publicUrl,
      arquivo: caminhoArquivo,
      tamanho_original_kb: Math.round(req.file.buffer.length / 1024),
      tamanho_otimizado_kb: Math.round(bufferOtimizado.length / 1024)
    });

  } catch (erro) {

    console.error("[PEDIDO] ERRO INTERNO UPLOAD:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: erro.message || "Erro interno upload."
    });
  }
});

/* =====================================================
   ADMIN PARCEIROS (patrocinadores) — listar, salvar,
   excluir e enviar logo. Tudo pelo servidor (service_role),
   como Produtos: a tela não grava mais direto no Supabase
   (as regras de RLS/Storage do navegador barravam
   "new row violates row-level security policy").
===================================================== */
const COTAS_PARCEIRO = ["diamante", "rubi", "ouro", "prata", "bronze"];

function montarParceiro(body) {
  const b = body || {};
  const cota = String(b.cota || "bronze").toLowerCase();
  const logo = String(b.logo_url || "").trim();
  if (!COTAS_PARCEIRO.includes(cota)) return { erro: "Cota inválida." };
  if (!logo) return { erro: "Envie a logo do parceiro antes de salvar." };
  return {
    dados: {
      nome: String(b.nome || "").trim().slice(0, 120) || "Parceiro",
      cota,
      link: String(b.link || "").trim().slice(0, 500) || null,
      ordem: parseInt(b.ordem, 10) || 0,
      ativo: b.ativo === true || b.ativo === "true",
      logo_url: logo
    }
  };
}

app.get("/admin/parceiros", exigirPagina("parceiros"), async (req, res) => {
  const { data, error } = await supabase
    .from("parceiros").select("*")
    .order("ordem", { ascending: true }).order("created_at", { ascending: true });
  if (error) {
    console.error("[PARCEIROS] ERRO LISTAR:", error);
    return res.status(500).json({ sucesso: false, erro: "Erro ao carregar parceiros." });
  }
  return res.json({ sucesso: true, parceiros: data || [] });
});

app.post("/admin/parceiros", exigirPagina("parceiros"), async (req, res) => {
  const m = montarParceiro(req.body);
  if (m.erro) return res.status(400).json({ sucesso: false, erro: m.erro });
  const { data, error } = await supabase.from("parceiros").insert(m.dados).select().single();
  if (error) {
    console.error("[PARCEIROS] ERRO INSERIR:", error);
    return res.status(500).json({ sucesso: false, erro: error.message });
  }
  return res.json({ sucesso: true, parceiro: data });
});

app.put("/admin/parceiros/:id", exigirPagina("parceiros"), async (req, res) => {
  const m = montarParceiro(req.body);
  if (m.erro) return res.status(400).json({ sucesso: false, erro: m.erro });
  const { data, error } = await supabase.from("parceiros")
    .update(m.dados).eq("id", req.params.id).select();
  if (error) {
    console.error("[PARCEIROS] ERRO ATUALIZAR:", error);
    return res.status(500).json({ sucesso: false, erro: error.message });
  }
  if (!data || data.length === 0) return res.status(404).json({ sucesso: false, erro: "Parceiro não encontrado." });
  return res.json({ sucesso: true, parceiro: data[0] });
});

app.delete("/admin/parceiros/:id", exigirPagina("parceiros"), async (req, res) => {
  const { data, error } = await supabase.from("parceiros")
    .delete().eq("id", req.params.id).select("id,logo_url");
  if (error) {
    console.error("[PARCEIROS] ERRO EXCLUIR:", error);
    return res.status(500).json({ sucesso: false, erro: error.message });
  }
  if (!data || data.length === 0) return res.status(404).json({ sucesso: false, erro: "Parceiro não encontrado." });

  /* apaga a logo do Storage (se for do bucket "parceiros"); falha aqui não desfaz a exclusão */
  try {
    const marca = "/storage/v1/object/public/parceiros/";
    const url = String(data[0].logo_url || "");
    const i = url.indexOf(marca);
    if (i >= 0) {
      const arquivo = decodeURIComponent(url.slice(i + marca.length).split("?")[0]);
      if (arquivo) await supabase.storage.from("parceiros").remove([arquivo]);
    }
  } catch (e) {
    console.error("[PARCEIROS] AVISO: não apagou a logo do Storage:", e.message);
  }
  return res.json({ sucesso: true });
});

app.post("/admin/parceiros/logo", exigirPagina("parceiros"), upload.single("logo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ sucesso: false, erro: "Nenhuma imagem enviada." });

    // WebP mantém o fundo transparente das logos; máx. 800px no lado maior
    const buffer = await sharp(req.file.buffer)
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();

    const arquivo = `parceiro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
    const { error } = await supabase.storage.from("parceiros")
      .upload(arquivo, buffer, { contentType: "image/webp", cacheControl: "3600", upsert: false });
    if (error) {
      console.error("[PARCEIROS] ERRO UPLOAD:", error);
      return res.status(500).json({ sucesso: false, erro: error.message });
    }
    const { data } = supabase.storage.from("parceiros").getPublicUrl(arquivo);
    return res.json({ sucesso: true, logo_url: data.publicUrl });
  } catch (erro) {
    console.error("[PARCEIROS] ERRO INTERNO UPLOAD:", erro);
    return res.status(500).json({ sucesso: false, erro: "Não foi possível processar a imagem. Use PNG, JPG ou WebP." });
  }
});




/* =====================================================
   CENTRAL DO CLIENTE - LOGIN REAL
===================================================== */

app.post("/cliente-login", limitadorLoginCliente, async (req, res) => {
  try {

    const { cpf, telefone } = req.body;

    if (!cpf || !telefone) {
      return res.status(400).json({
        sucesso: false,
        erro: "CPF e telefone são obrigatórios."
      });
    }

    const cpfLimpo = limparCPF(cpf);
    const telefoneLimpo = limparTelefone(telefone);

    if (!validarCPF(cpfLimpo)) {
      return res.status(400).json({
        sucesso: false,
        erro: "CPF inválido."
      });
    }

    const { data, error } = await supabase
      .from("pedidos")
      .select("*")
      .eq("cpf", cpfLimpo)
      .eq("telefone", telefoneLimpo)
      .order("id", { ascending: false });

    /* ===== BUSCAR CARTELAS DO MESMO CPF (independente de ter
       pedido de produto ou não — alguém pode ter comprado só
       cartela, sem nunca ter comprado produto) ===== */
    const { data: cartelas, error: erroCartelas } = await supabase
      .from("cartelas")
      .select("*")
      .eq("cpf_comprador", cpfLimpo)
      .in("status", ["pago", "pendente"])
      .order("id", { ascending: false });

    if (erroCartelas) {
      console.error("[ERROR] ERRO BUSCAR CARTELAS DO CLIENTE:", erroCartelas);
      // não bloqueia o login por causa disso — segue só sem as cartelas
    }

    const temPedidos = !error && data && data.length > 0;
    const temCartelas = !erroCartelas && cartelas && cartelas.length > 0;

    /* Se a pessoa não tem NEM pedido NEM cartela com esse CPF+telefone,
       mantém o comportamento de erro de antes */
    if (!temPedidos && !temCartelas) {
      return res.status(404).json({
        sucesso: false,
        erro: "Cliente não encontrado."
      });
    }

    const { data: produtos } = await supabase
      .from("produtos")
      .select("codigo,nome,imagem");

    await vendas.anexarItens(supabase, data || [], { comEntregas: true });

    const pedidosEnriquecidos = (data || []).map(pedido => {

      const produto = produtos?.find(
        p => p.codigo === pedido.produto_tipo
      );

      const itensDoPedido = pedido.itens || [];
      const primeiro = itensDoPedido[0];
      const produtoPrimeiro = primeiro ? produtos?.find(p => p.codigo === primeiro.produto_codigo) : null;

      return {
        ...pedido,
        nome_produto: itensDoPedido.length > 1
          ? pedido.resumo_itens
          : (produto?.nome || primeiro?.produto_nome || pedido.produto_tipo),
        imagem_produto: produto?.imagem || produtoPrimeiro?.imagem || null
      };
    });

    /* Dados básicos do cliente (nome/cpf/telefone) podem vir do
       pedido OU da cartela, dependendo do que a pessoa tiver */
    const nomeCliente = data && data.length
      ? `${data[0].nome || ""} ${data[0].sobrenome || ""}`.trim()
      : (cartelas && cartelas.length ? cartelas[0].nome_comprador : "");

    return res.json({
      sucesso: true,
      cliente: {
        nome: nomeCliente,
        cpf: cpfLimpo,
        telefone: telefoneLimpo,
        total_pedidos: pedidosEnriquecidos.length,
        pedidos: pedidosEnriquecidos,
        total_cartelas: (cartelas || []).length,
        cartelas: cartelas || []
      }
    });

  } catch (erro) {

    console.error("[ERROR] ERRO CLIENTE LOGIN:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno no login."
    });
  }
});



/* ==========================================
   START SERVER
========================================== */
const PORT = process.env.PORT || 3000;

/* =====================================================
   BLOCO DE ALTA SEGURANÇA - ROTA VIP DEFINITIVA
===================================================== */

/* =====================================================
   TESTE CONSULTA PIX SICREDI
===================================================== */

app.get("/sicredi/teste-consulta/:txid", limitadorAdmin, async (req, res) => {

  try {

    const { txid } = req.params;

    const resultado = await consultarPix(txid);

    return res.json(resultado);

  } catch (erro) {

    console.error(
      "[PIX]", erro.response?.data || erro.message
    );

    return res.status(500).json(
      erro.response?.data || {
        erro: erro.message
      }
    );

  }

});



/* =====================================================
   ACESSO DO USUÁRIO LOGADO — telas liberadas pro perfil dele
   (o painel usa pra montar o menu e barrar telas não liberadas)
===================================================== */
app.get("/admin/acesso", verificarEquipeLogada, (req, res) => {
  return res.json({
    sucesso: true,
    papel: req.papelUsuario,
    nome: req.nomeUsuario,
    paginas: req.paginasUsuario || []
  });
});

/* =====================================================
   PERFIS DE ACESSO — telas de Padrão e Voluntário (só admin)
===================================================== */
app.get("/admin/perfis", verificarAdminBackend, async (req, res) => {
  const { data, error } = await supabase
    .from("perfis_acesso").select("papel,paginas,atualizado_em,atualizado_por");
  if (error) {
    console.error("[ACESSO] ERRO LER PERFIS:", error);
    return res.status(500).json({
      sucesso: false,
      erro: "Tabela de perfis não encontrada. Rode no Supabase o SQL 2026-10-05b-perfis-de-acesso.sql."
    });
  }
  const perfis = {};
  PAPEIS_EQUIPE.forEach(p => { perfis[p] = { paginas: [], atualizado_em: null, atualizado_por: null }; });
  (data || []).forEach(r => {
    if (perfis[r.papel]) perfis[r.papel] = {
      paginas: (r.paginas || []).filter(k => CHAVES_PAGINAS.includes(k)),
      atualizado_em: r.atualizado_em,
      atualizado_por: r.atualizado_por
    };
  });
  return res.json({ sucesso: true, paginas: PAGINAS_ADMIN, perfis });
});

app.put("/admin/perfis/:papel", verificarAdminBackend, async (req, res) => {
  const papel = String(req.params.papel || "");
  if (!PAPEIS_EQUIPE.includes(papel)) {
    return res.status(400).json({ sucesso: false, erro: "Perfil inválido." });
  }
  const recebidas = Array.isArray(req.body?.paginas) ? req.body.paginas.map(String) : null;
  if (!recebidas) return res.status(400).json({ sucesso: false, erro: "Envie a lista de telas." });
  const paginas = CHAVES_PAGINAS.filter(k => recebidas.includes(k));

  const { error } = await supabase.from("perfis_acesso").upsert({
    papel,
    paginas,
    atualizado_em: new Date().toISOString(),
    atualizado_por: req.nomeUsuario
  }, { onConflict: "papel" });
  if (error) {
    console.error("[ACESSO] ERRO SALVAR PERFIL:", error);
    return res.status(500).json({ sucesso: false, erro: error.message });
  }
  limparCachePerfis();
  return res.json({ sucesso: true, papel, paginas });
});

/* =====================================================
   ADMIN USUÁRIOS — LISTAR
===================================================== */
app.get("/admin/usuarios", verificarAdminBackend, async (req, res) => {

  try {

    const { data, error } = await supabase
      .from("user_profiles")
      .select("id, nome, email, role, acesso_blocos, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        sucesso: false,
        erro: error.message || "Erro ao listar usuários."
      });
    }

    return res.json({
      sucesso: true,
      usuarios: data
    });

  } catch (erro) {

    console.error("[ADMIN] ERRO LISTAR USUARIOS:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao listar usuários."
    });

  }

});

/* =====================================================
   ADMIN USUÁRIOS — CRIAR
===================================================== */
app.post("/admin/usuarios", verificarAdminBackend, async (req, res) => {

  try {

    const { nome, email, password, role, acesso_blocos } = req.body || {};

    if (!nome || !email || !password) {
      return res.status(400).json({
        sucesso: false,
        erro: "Nome, e-mail e senha são obrigatórios."
      });
    }

    if (String(password).length < 6) {
      return res.status(400).json({
        sucesso: false,
        erro: "A senha precisa ter pelo menos 6 caracteres."
      });
    }

    const roleFinal = PAPEIS_VALIDOS.includes(role) ? role : "voluntario";

    const emailNormalizado = String(email).trim().toLowerCase();

    /* CRIA O USUÁRIO NO AUTH (exige service_role — já é a chave em uso) */
    const { data: novoUsuario, error: createError } =
      await supabase.auth.admin.createUser({
        email: emailNormalizado,
        password: String(password),
        email_confirm: true
      });

    if (createError) {
      console.error("[ADMIN] ERRO CRIAR USUARIO AUTH:", createError);
      return res.status(500).json({
        sucesso: false,
        erro: createError.message || "Erro ao criar usuário."
      });
    }

    /* CRIA O PERFIL */
    const { error: perfilError } = await supabase
      .from("user_profiles")
      .insert([{
        id: novoUsuario.user.id,
        nome: String(nome).trim(),
        email: emailNormalizado,
        role: roleFinal,
        acesso_blocos: acesso_blocos === true
      }]);

    if (perfilError) {

      console.error("[ERROR] ERRO CRIAR PERFIL:", perfilError);

      /* perfil falhou — desfaz a criação do usuário pra não deixar
         um usuário "fantasma" sem perfil */
      await supabase.auth.admin.deleteUser(novoUsuario.user.id);

      return res.status(500).json({
        sucesso: false,
        erro: "Erro ao salvar perfil do usuário. Operação desfeita."
      });

    }

    return res.json({
      sucesso: true,
      mensagem: "Usuário criado com sucesso."
    });

  } catch (erro) {

    console.error("[ADMIN] ERRO INTERNO CRIAR USUARIO:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao criar usuário."
    });

  }

});

/* =====================================================
   ADMIN USUÁRIOS — EDITAR (nome e papel)
===================================================== */
app.put("/admin/usuarios/:id", verificarAdminBackend, async (req, res) => {

  try {

    const { id } = req.params;
    const { nome, role, acesso_blocos } = req.body || {};

    if (!nome) {
      return res.status(400).json({
        sucesso: false,
        erro: "Nome é obrigatório."
      });
    }

    const roleFinal = PAPEIS_VALIDOS.includes(role) ? role : "voluntario";

    if (id === req.usuarioAdmin.id && roleFinal !== "admin") {
      return res.status(400).json({
        sucesso: false,
        erro: "Você não pode remover o seu próprio acesso de administrador."
      });
    }

    const { error } = await supabase
      .from("user_profiles")
      .update({
        nome: String(nome).trim(),
        role: roleFinal,
        acesso_blocos: acesso_blocos === true
      })
      .eq("id", id);

    if (error) {
      console.error("[ADMIN] ERRO EDITAR USUARIO:", error);
      return res.status(500).json({
        sucesso: false,
        erro: error.message || "Erro ao editar usuário."
      });
    }

    return res.json({
      sucesso: true,
      mensagem: "Usuário atualizado com sucesso."
    });

  } catch (erro) {

    console.error("[ADMIN] ERRO INTERNO EDITAR USUARIO:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao editar usuário."
    });

  }

});

/* =====================================================
   ADMIN USUÁRIOS — EXCLUIR
===================================================== */
app.delete("/admin/usuarios/:id", verificarAdminBackend, async (req, res) => {

  try {

    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        sucesso: false,
        erro: "ID do usuário é obrigatório."
      });
    }

    if (id === req.usuarioAdmin.id) {
      return res.status(400).json({
        sucesso: false,
        erro: "Você não pode excluir o seu próprio usuário."
      });
    }

    const { error: authError } =
      await supabase.auth.admin.deleteUser(id);

    if (authError) {
      console.error("[ADMIN] ERRO EXCLUIR USUARIO AUTH:", authError);
      return res.status(500).json({
        sucesso: false,
        erro: authError.message || "Erro ao excluir usuário."
      });
    }

    await supabase.from("user_profiles").delete().eq("id", id);

    return res.json({
      sucesso: true,
      mensagem: "Usuário excluído com sucesso."
    });

  } catch (erro) {

    console.error("[ADMIN] ERRO INTERNO EXCLUIR USUARIO:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao excluir usuário."
    });

  }

});


/* =====================================================================
   CARTELAS DO BINGO — FÍSICAS + DIGITAIS (FPSS 2027)
   Cole este bloco inteiro no server.js, ANTES da linha:
   app.listen(PORT, () => { ... });

   Usa as mesmas funções já importadas no topo do server.js:
   criarPix, consultarPix, supabase, limparCPF, limparTelefone, validarCPF
===================================================================== */


/* =====================================================
   CARTELAS — VALIDAR NÚMERO (cartela física)
   Usado pelo formulário, em tempo real, antes de pagar.
===================================================== */
app.post("/cartelas/validar-numero", async (req, res) => {
  try {

    const { numero } = req.body;

    if (!numero) {
      return res.status(400).json({
        sucesso: false,
        erro: "Informe o número da cartela."
      });
    }

    const loteFisica = await buscarLoteAtivo(supabase, "fisica");

    if (!loteFisica) {
      return res.status(503).json({
        sucesso: false,
        valido: false,
        erro: "Vendas de cartela física estão temporariamente indisponíveis."
      });
    }

    /* ===== LIBERA DE VOLTA PRO ESTOQUE QUALQUER RESERVA EXPIRADA
       antes de checar esta cartela — assim, se a reserva antiga já
       passou de 1h, ela conta como livre de novo ===== */
    await supabase.rpc("liberar_cartelas_expiradas");

    const termoDigitado = String(numero).trim();
    const termoNormalizado = normalizarNumeroDigitado(numero);

    const { data: cartela, error } = await supabase
      .from("cartelas")
      .select("*")
      .or(`numero_chance1.eq.${termoDigitado},numero_chance2.eq.${termoDigitado},numero_chance1.eq.${termoNormalizado},numero_chance2.eq.${termoNormalizado}`)
      .eq("tipo", "fisica")
      .eq("lote", loteFisica.chave)
      .maybeSingle();

    if (error) {
      console.error("[ERROR] ERRO VALIDAR NUMERO CARTELA:", error);
      return res.status(500).json({
        sucesso: false,
        erro: "Erro interno ao validar a cartela."
      });
    }

    if (!cartela) {
      return res.status(404).json({
        sucesso: false,
        valido: false,
        erro: "Essa cartela não existe. Verifique o número e tente novamente."
      });
    }

    if (cartela.status === "pago") {
      return res.status(404).json({
        sucesso: false,
        valido: false,
        erro: "Essa cartela já foi paga anteriormente."
      });
    }

    if (cartela.status === "cancelado") {
      return res.status(404).json({
        sucesso: false,
        valido: false,
        erro: "Essa cartela foi cancelada e não pode ser paga."
      });
    }

    if (cartela.status === "pendente") {
      return res.status(404).json({
        sucesso: false,
        valido: false,
        erro: "Essa cartela já está reservada, aguardando pagamento de um Pix gerado anteriormente. Se foi você quem gerou, confira em \"Minha Cartela\" — se já passou de 1h, ela é liberada automaticamente."
      });
    }

    return res.json({
      sucesso: true,
      valido: true
    });

  } catch (erro) {

    console.error("[ERROR] ERRO INTERNO VALIDAR NUMERO CARTELA:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao validar a cartela."
    });
  }
});

/* =====================================================
   CARTELAS — GERAR PIX (CARTELA FÍSICA)
===================================================== */
app.post("/cartelas/pix-fisica", limitadorPix, async (req, res) => {
  try {

    const {
      numero_cartela,
      nome: nomeBruto,
      cpf,
      telefone,
      vai_na_festa
    } = req.body;

    const nome = sanitizarTexto(nomeBruto, 150);
    const cpfLimpo = limparCPF(cpf);
    const telefoneLimpo = limparTelefone(telefone);

    if (!numero_cartela) {
      return res.status(400).json({
        sucesso: false,
        erro: "Número da cartela é obrigatório."
      });
    }

    if (!nome) {
      return res.status(400).json({
        sucesso: false,
        erro: "Nome é obrigatório."
      });
    }

    if (!validarCPF(cpfLimpo)) {
      return res.status(400).json({
        sucesso: false,
        erro: "CPF inválido."
      });
    }

    if (!["sim", "talvez", "nao"].includes(vai_na_festa)) {
      return res.status(400).json({
        sucesso: false,
        erro: "Informe se vai participar da festa."
      });
    }

    const loteFisica = await buscarLoteAtivo(supabase, "fisica");

    if (!loteFisica) {
      return res.status(503).json({
        sucesso: false,
        erro: "Vendas de cartela física estão temporariamente indisponíveis."
      });
    }

    /* ===== LIBERA DE VOLTA PRO ESTOQUE QUALQUER RESERVA EXPIRADA
       (pendente há mais de 1h sem pagamento) ANTES de checar
       se esta cartela específica ainda está disponível ===== */
    await supabase.rpc("liberar_cartelas_expiradas");

    /* ===== VALIDAR A CARTELA DE NOVO (proteção no servidor,
       não confiar só na validação em tempo real do frontend) =====
       Aceita tanto numero_chance1 quanto numero_chance2 — o
       comprador pode digitar qualquer um dos dois números
       impressos no canhoto da cartela física. */
    const termoDigitadoFisica = String(numero_cartela).trim();
    const termoNormalizadoFisica = normalizarNumeroDigitado(numero_cartela);

    const { data: cartela, error: buscaErro } = await supabase
      .from("cartelas")
      .select("*")
      .or(`numero_chance1.eq.${termoDigitadoFisica},numero_chance2.eq.${termoDigitadoFisica},numero_chance1.eq.${termoNormalizadoFisica},numero_chance2.eq.${termoNormalizadoFisica}`)
      .eq("tipo", "fisica")
      .eq("lote", loteFisica.chave)
      .maybeSingle();

    if (buscaErro) {
      console.error("[ERROR] ERRO BUSCAR CARTELA FISICA:", buscaErro);
      return res.status(500).json({
        sucesso: false,
        erro: "Erro interno ao buscar a cartela."
      });
    }

    if (!cartela) {
      return res.status(404).json({
        sucesso: false,
        erro: "Essa cartela não existe. Verifique o número e tente novamente."
      });
    }

    if (cartela.status !== "disponivel") {
      return res.status(400).json({
        sucesso: false,
        erro: "Essa cartela já foi paga ou não está mais disponível."
      });
    }

    const valor = valorEmReais(loteFisica);

    /* ===== SICREDI PIX ===== */
    const pagamento = await criarPix(valor, nome, cpfLimpo);

    const agora = new Date();
    const expiraEm = new Date(agora.getTime() + 60 * 60 * 1000); // 1h, mesmo prazo do Pix

    /* ===== ATUALIZAR CARTELA (com proteção contra concorrência:
       só atualiza se ainda estiver "disponivel" nesse exato momento) ===== */
    const { data: cartelaAtualizada, error: updateErro } = await supabase
      .from("cartelas")
      .update({
        status: "pendente",
        nome_comprador: nome,
        cpf_comprador: cpfLimpo,
        whatsapp_comprador: telefoneLimpo,
        vai_na_festa,
        valor_pago: valor,
        pix_id: pagamento.txid,
        reservado_em: agora.toISOString()
      })
      .eq("id", cartela.id)
      .eq("status", "disponivel")
      .select()
      .single();

    if (updateErro || !cartelaAtualizada) {
      return res.status(409).json({
        sucesso: false,
        erro: "Essa cartela acabou de ser reservada por outra pessoa. Tente novamente com outro número."
      });
    }

    return res.status(200).json({
      sucesso: true,
      mensagem: "Pix gerado com sucesso.",
      txid: pagamento.txid,
      numero_cartela: cartelaAtualizada.numero_chance1,
      numero_chance2: cartelaAtualizada.numero_chance2,
      tipo: cartelaAtualizada.tipo,
      valor: valor,
      pixCopiaECola: pagamento.pixCopiaECola,
      qrCode: pagamento.qrCodeBase64,
      expira_em: expiraEm.toISOString()
    });

  } catch (erro) {

    console.error("[PIX] ERRO GERAR PIX CARTELA FISICA:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao gerar Pix da cartela física."
    });
  }
});

/* =====================================================
   CARTELAS — GERAR PIX (CARTELA DIGITAL)
   Atribui automaticamente o próximo número digital
   disponível, usando a função SQL reservar_cartela_digital
   (criada no script 01_criar_tabela_cartelas.sql), que usa
   lock no banco pra evitar duas pessoas recebendo o mesmo
   número ao comprar ao mesmo tempo.
===================================================== */
app.post("/cartelas/pix-digital", limitadorPix, async (req, res) => {
  try {

    const {
      nome: nomeBruto,
      cpf,
      telefone,
      vai_na_festa,
      cep,
      cidade: cidadeBruta,
      bairro: bairroBruto,
      rua: ruaBruta,
      numero_endereco: numeroEnderecoBruto
    } = req.body;

    const nome = sanitizarTexto(nomeBruto, 150);
    const cidade = sanitizarTexto(cidadeBruta, 100);
    const bairro = sanitizarTexto(bairroBruto, 100);
    const rua = sanitizarTexto(ruaBruta, 150);
    const numero_endereco = sanitizarTexto(numeroEnderecoBruto, 20);
    const cpfLimpo = limparCPF(cpf);
    const telefoneLimpo = limparTelefone(telefone);

    if (!nome) {
      return res.status(400).json({
        sucesso: false,
        erro: "Nome é obrigatório."
      });
    }

    if (!validarCPF(cpfLimpo)) {
      return res.status(400).json({
        sucesso: false,
        erro: "CPF inválido."
      });
    }

    if (!["sim", "talvez", "nao"].includes(vai_na_festa)) {
      return res.status(400).json({
        sucesso: false,
        erro: "Informe se vai participar da festa."
      });
    }

    // endereço do comprador (usado no cupom do verso da cartela digital)
    const limparTexto = (valor) => String(valor || "").trim().slice(0, 120) || null;
    const enderecoComprador = {
      cep: String(cep || "").replace(/\D/g, "").slice(0, 8) || null,
      cidade: limparTexto(cidade),
      bairro: limparTexto(bairro),
      rua: limparTexto(rua),
      numero_endereco: limparTexto(numero_endereco)
    };

    const loteDigital = await buscarLoteAtivo(supabase, "digital");

    if (!loteDigital) {
      return res.status(503).json({
        sucesso: false,
        erro: "Vendas de cartela digital estão temporariamente indisponíveis."
      });
    }

    /* ===== RESERVAR UM NÚMERO DIGITAL (com lock no banco) ===== */
    const { data: cartelaReservada, error: erroReserva } = await supabase
      .rpc("reservar_cartela_digital", { p_lote: loteDigital.chave });

    if (erroReserva) {

      if (String(erroReserva.message || "").includes("NENHUMA_CARTELA_DIGITAL_DISPONIVEL")) {
        return res.status(409).json({
          sucesso: false,
          erro: "Não há cartelas digitais disponíveis no momento."
        });
      }

      console.error("[ERROR] ERRO RESERVAR CARTELA DIGITAL:", erroReserva);

      return res.status(500).json({
        sucesso: false,
        erro: "Erro interno ao reservar cartela digital."
      });
    }

    const valor = valorEmReais(loteDigital);

    /* ===== SICREDI PIX ===== */
    const pagamento = await criarPix(valor, nome, cpfLimpo);

    /* ===== ATUALIZAR CARTELA COM DADOS DO COMPRADOR ===== */
    const { data: cartelaAtualizada, error: updateErro } = await supabase
      .from("cartelas")
      .update({
        nome_comprador: nome,
        cpf_comprador: cpfLimpo,
        whatsapp_comprador: telefoneLimpo,
        vai_na_festa,
        ...enderecoComprador,
        valor_pago: valor,
        pix_id: pagamento.txid
      })
      .eq("id", cartelaReservada.id)
      .select()
      .single();

    if (updateErro) {
      console.error("[ERROR] ERRO SALVAR DADOS CARTELA DIGITAL:", updateErro);

      return res.status(500).json({
        sucesso: false,
        erro: "Erro interno ao salvar os dados da cartela digital."
      });
    }

    return res.status(200).json({
      sucesso: true,
      mensagem: "Pix gerado com sucesso.",
      txid: pagamento.txid,
      numero_cartela: cartelaAtualizada.numero_chance1,
      numero_chance2: cartelaAtualizada.numero_chance2,
      tipo: cartelaAtualizada.tipo,
      valor: valor,
      pixCopiaECola: pagamento.pixCopiaECola,
      qrCode: pagamento.qrCodeBase64,
      expira_em: new Date(
        new Date(cartelaReservada.reservado_em).getTime() + 60 * 60 * 1000
      ).toISOString()
    });

  } catch (erro) {

    console.error("[PIX] ERRO GERAR PIX CARTELA DIGITAL:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao gerar Pix da cartela digital."
    });
  }
});
/* =====================================================================
   ADICIONAR esta rota no server.js, logo depois da rota
   app.post("/cartelas/pix-digital", ...) — ou em qualquer lugar
   dentro do bloco de rotas de cartelas, antes do
   app.get("/cartelas/verificar-pagamento/:txid", ...).

   O QUE FAZ:
   Usado no painel do cliente quando uma cartela já existe com
   status "pendente" (o Pix anterior expirou em 1h, como configurado
   em criarPix, e nunca foi pago). Em vez de reservar um número novo,
   pega a cartela já existente pelo ID e gera um Pix NOVO para ela,
   sobrescrevendo o pix_id antigo.

   SEGURANÇA CONTRA PAGAMENTO DUPLICADO:
   A rota /cartelas/verificar-pagamento/:txid (linha ~2188) busca a
   cartela pelo pix_id ATUAL salvo no banco. Como esta rota sobrescreve
   o pix_id, qualquer confirmação do Pix antigo (mesmo que alguém
   pague-o por engano depois de já ter um Pix novo gerado) não vai
   encontrar nenhuma cartela correspondente — não credita nada,
   simplesmente não acontece nada. Não há risco de cobrar a pessoa
   duas vezes nem de gerar duas cartelas pagas para o mesmo registro.
===================================================================== */

app.post("/cartelas/:id/retomar-pagamento", limitadorPix, async (req, res) => {
  try {

    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        sucesso: false,
        erro: "ID da cartela é obrigatório."
      });
    }

    /* ===== BUSCAR A CARTELA ===== */
    const { data: cartela, error: erroBusca } = await supabase
      .from("cartelas")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (erroBusca) {
      console.error("[PIX] ERRO BUSCAR CARTELA RETOMAR PAGAMENTO:", erroBusca);

      return res.status(500).json({
        sucesso: false,
        erro: "Erro interno ao buscar a cartela."
      });
    }

    if (!cartela) {
      return res.status(404).json({
        sucesso: false,
        erro: "Cartela não encontrada."
      });
    }

    /* ===== VALIDAÇÕES DE STATUS ===== */
    if (cartela.status === "pago") {
      return res.status(409).json({
        sucesso: false,
        erro: "Essa cartela já foi paga. Não é possível gerar um novo Pix."
      });
    }

    if (cartela.status === "cancelado") {
      return res.status(409).json({
        sucesso: false,
        erro: "Essa cartela foi cancelada e não pode ser paga."
      });
    }

    if (cartela.status !== "pendente") {
      return res.status(409).json({
        sucesso: false,
        erro: `Esta cartela está com status "${cartela.status}" e não pode ter o pagamento retomado.`
      });
    }

    if (!cartela.nome_comprador || !cartela.cpf_comprador) {
      return res.status(400).json({
        sucesso: false,
        erro: "Esta cartela não tem dados de comprador salvos. Não é possível retomar o pagamento automaticamente."
      });
    }

    /* ===== GERAR PIX NOVO (mesmo valor já registrado na cartela) ===== */
    const valor = Number(cartela.valor_pago);

    const pagamento = await criarPix(valor, cartela.nome_comprador, cartela.cpf_comprador);

    /* ===== ATUALIZAR PIX_ID — E SÓ RENOVAR reservado_em SE JÁ ESTIVER
       REALMENTE VENCIDO =====
       Antes, isso renovava o prazo sempre, incondicionalmente. Só que
       aí o relógio reiniciava mesmo quando ainda faltava bastante
       tempo, o que não batia com o cronômetro que a pessoa via no
       painel um segundo antes de clicar em "Pagar agora" — dava a
       sensação (correta!) de que o sistema tinha "esquecido" quanto
       tempo já tinha passado.
       Agora: se a reserva original ainda está dentro da 1h, mantém
       reservado_em como estava — o cronômetro continua exatamente de
       onde parou. Só renova de verdade se ela já tiver passado da 1h
       (caso ainda esteja "pendente" por não ter sido liberada ainda),
       porque aí sim precisamos de um prazo novo pro Pix novo não cair
       como "expirado" na hora. */
    const agora = new Date();

    const reservaAtualExpirada =
      !cartela.reservado_em ||
      (new Date(cartela.reservado_em).getTime() + 60 * 60 * 1000 < agora.getTime());

    const dadosAtualizacao = { pix_id: pagamento.txid };

    if (reservaAtualExpirada) {
      dadosAtualizacao.reservado_em = agora.toISOString();
    }

    const { data: cartelaAtualizada, error: erroUpdate } = await supabase
      .from("cartelas")
      .update(dadosAtualizacao)
      .eq("id", cartela.id)
      .eq("status", "pendente") // proteção: só atualiza se ainda estiver pendente nesse exato momento
      .select()
      .single();

    if (erroUpdate || !cartelaAtualizada) {
      console.error("[PIX] ERRO ATUALIZAR PIX_ID RETOMAR PAGAMENTO:", erroUpdate);

      return res.status(409).json({
        sucesso: false,
        erro: "Não foi possível atualizar a cartela. Ela pode ter sido paga ou alterada nos últimos instantes — atualize a página e tente novamente."
      });
    }

    return res.status(200).json({
      sucesso: true,
      mensagem: "Novo Pix gerado com sucesso.",
      txid: pagamento.txid,
      numero_cartela: cartelaAtualizada.numero_chance1,
      numero_chance2: cartelaAtualizada.numero_chance2,
      tipo: cartelaAtualizada.tipo,
      valor: valor,
      pixCopiaECola: pagamento.pixCopiaECola,
      qrCode: pagamento.qrCodeBase64,
      expira_em: new Date(
        new Date(cartelaAtualizada.reservado_em).getTime() + 60 * 60 * 1000
      ).toISOString()
    });

  } catch (erro) {

    console.error("[PIX] ERRO RETOMAR PAGAMENTO CARTELA:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao gerar novo Pix para a cartela."
    });
  }
});


/* =====================================================
   CARTELAS — VERIFICAR PAGAMENTO
   Mesmo modelo de polling usado em /verificar-pagamento/:txid
   (produtos), adaptado pra tabela "cartelas" — sem retirada.
===================================================== */
const CAMINHO_ARTE_BASE = path.join(__dirname, "assets", "arte-cartela-2027-oficial.png");
const CAMINHO_ARTE_VERSO = path.join(__dirname, "assets", "arte-cartela-2027-verso.png");

// txids cuja geração da cartela digital está rodando agora — evita disparar
// duas gerações em paralelo pro mesmo pagamento se dois polls se cruzarem
const cartelasDigitaisEmGeracao = new Set();

/* =====================================================
   Gera a arte da cartela digital (PNG) e sobe pro storage,
   depois atualiza a linha no Supabase com o pdf_url pronto.
   Roda desacoplado da resposta HTTP (ver chamada mais abaixo).
===================================================== */
async function gerarEGuardarCartelaDigital(cartelaAtual, txid) {

  const inicioGeracao = Date.now();

  const dadosComprador = {
    numeroChance1: cartelaAtual.numero_chance1,
    numeroChance2: cartelaAtual.numero_chance2,
    nomeComprador: cartelaAtual.nome_comprador,
    cpfComprador: cartelaAtual.cpf_comprador,
    whatsappComprador: cartelaAtual.whatsapp_comprador,
    rua: cartelaAtual.rua,
    numeroEndereco: cartelaAtual.numero_endereco,
    bairro: cartelaAtual.bairro,
    cidade: cartelaAtual.cidade
  };

  // Frente e verso são duas artes independentes (não dependem uma da
  // outra) — gerar as duas ao mesmo tempo em vez de uma depois da outra
  // corta bastante o tempo total de espera do comprador.
  const [pngBuffer, versoBuffer] = await Promise.all([
    gerarCartelaDigitalPNG(
      {
        ...dadosComprador,
        gradeChance1: cartelaAtual.grade_chance1,
        gradeChance2: cartelaAtual.grade_chance2
      },
      CAMINHO_ARTE_BASE
    ),
    gerarVersoCartelaPNG(dadosComprador, CAMINHO_ARTE_VERSO)
  ]);

  const tempoGeracaoMs = Date.now() - inicioGeracao;

  // Os dois uploads pro Storage também são independentes entre si.
  const inicioUpload = Date.now();

  const [pdfUrl] = await Promise.all([
    uploadCartelaDigital(
      supabase,
      cartelaAtual.numero_chance1,
      pngBuffer
    ),
    uploadCartelaDigital(
      supabase,
      cartelaAtual.numero_chance1,
      versoBuffer,
      "-verso"
    )
  ]);

  const tempoUploadMs = Date.now() - inicioUpload;

  const { error: updateErro } = await supabase
    .from("cartelas")
    .update({
      pdf_url: pdfUrl,
      pdf_gerado_em: new Date().toISOString()
    })
    .eq("pix_id", txid);

  if (updateErro) {
    console.error("[ERROR] ERRO AO SALVAR PDF_URL DA CARTELA DIGITAL:", updateErro);
  }

  console.log(
    `[INFO] [gerarEGuardarCartelaDigital] txid=${txid} geracao_ms=${tempoGeracaoMs} upload_ms=${tempoUploadMs} total_ms=${Date.now() - inicioGeracao}`
  );
}

app.get("/cartelas/verificar-pagamento/:txid", limitadorPolling, async (req, res) => {
  try {

    const { txid } = req.params;
    const pagamento = await consultarPix(txid);

    const statusPagamento = pagamento.status;

    console.log(`[verificar-pagamento] txid=${txid} status_sicredi=${statusPagamento}`);

    /* ===== PAGAMENTO APROVADO ===== */
    if (statusPagamento === "CONCLUIDA") {

      const { data: cartelaAtual, error: buscaErro } = await supabase
        .from("cartelas")
        .select("*")
        .eq("pix_id", txid)
        .single();

      if (buscaErro || !cartelaAtual) {
        return res.status(404).json({
          sucesso: false,
          erro: "Cartela não encontrada."
        });
      }

      let comprovanteId = cartelaAtual.comprovante_id;
      let pdfUrl = cartelaAtual.pdf_url;

      if (cartelaAtual.status !== "pago") {

        comprovanteId = `COMP-${txid}`;

        const dadosAtualizacao = {
          status: "pago",
          data_pagamento: new Date().toISOString(),
          comprovante_id: comprovanteId
        };

        const { error: updateErro } = await supabase
          .from("cartelas")
          .update(dadosAtualizacao)
          .eq("pix_id", txid);

        if (updateErro) {
          console.error("[PIX] ERRO ATUALIZAR PAGAMENTO CARTELA:", updateErro);
        }
      }

      /* ===== GERAR A CARTELA DIGITAL EM SEGUNDO PLANO =====
         Não usamos "await" aqui de propósito: a resposta pro frontend
         sai na hora avisando que o pagamento foi confirmado (pdf_url
         ainda null), e o próximo polling do frontend (a cada 5s) já
         pega o pdf_url assim que a geração/upload da imagem terminar.
         Isso evita que o cliente fique com a tela travada esperando a
         geração da arte pra só então saber que o pagamento passou.

         IMPORTANTE: roda em TODO poll enquanto pdf_url continuar nulo —
         não só na transição pendente->pago. Um serviço grátis como o
         Render pode suspender o processo logo depois da resposta HTTP
         sair, mesmo com essa promise ainda rodando; sem essa repetição,
         uma única tentativa interrompida deixava a cartela sem imagem
         pra sempre, mesmo com o polling batendo aqui a cada 5s. O Set
         evita disparar duas gerações em paralelo pro mesmo txid se dois
         polls se cruzarem antes da primeira terminar. */
      if (
        cartelaAtual.tipo === "digital" &&
        !cartelaAtual.pdf_url &&
        !cartelasDigitaisEmGeracao.has(txid)
      ) {
        cartelasDigitaisEmGeracao.add(txid);

        gerarEGuardarCartelaDigital(cartelaAtual, txid)
          .catch((erroGeracao) => {
            console.error("[ERROR] ERRO AO GERAR CARTELA DIGITAL (segundo plano):", erroGeracao);
          })
          .finally(() => {
            cartelasDigitaisEmGeracao.delete(txid);
          });
      }

      return res.json({
        sucesso: true,
        status_interno: "pago",
        data_pagamento: cartelaAtual.data_pagamento || new Date().toISOString(),
        cartela: {
          numero_cartela: cartelaAtual.numero_chance1,
          numero_chance2: cartelaAtual.numero_chance2,
          tipo: cartelaAtual.tipo,
          nome: cartelaAtual.nome_comprador,
          cpf: cartelaAtual.cpf_comprador,
          telefone: cartelaAtual.whatsapp_comprador,
          valor: cartelaAtual.valor_pago,
          comprovante_id: comprovanteId,
          pdf_url: pdfUrl
        }
      });
    }

    /* ===== AINDA NÃO PAGO — checa se a reserva já expirou =====
       Importante: só chega aqui se o Sicredi disse que NÃO está
       concluído ainda, então não tem risco de derrubar um
       pagamento que acabou de cair — a checagem de "pago" sempre
       vem primeiro, acima. */
    const { data: cartelaPendente, error: erroBuscaPendente } = await supabase
      .from("cartelas")
      .select("status, reservado_em")
      .eq("pix_id", txid)
      .maybeSingle();

    if (erroBuscaPendente) {
      console.error("[PIX] ERRO BUSCAR CARTELA PENDENTE (verificar-pagamento):", erroBuscaPendente);
    }

    // Só considera expirado com base numa confirmação real de
    // reservado_em antigo. Se a cartela não foi encontrada ou o
    // reservado_em está ausente, NÃO assume expiração — isso evita
    // marcar como expirada por causa de um soluço passageiro na
    // consulta, em vez de simplesmente tentar de novo no próximo
    // polling (a cada 5s).
    const expirou =
      !!cartelaPendente &&
      cartelaPendente.status === "pendente" &&
      !!cartelaPendente.reservado_em &&
      new Date(cartelaPendente.reservado_em).getTime() + 60 * 60 * 1000 < Date.now();

    if (expirou) {
      // garante a liberação no banco (idempotente — não faz nada
      // se já tiver sido liberada por outra reserva nesse meio tempo)
      await supabase.rpc("liberar_cartelas_expiradas");

      return res.json({
        sucesso: true,
        status_interno: "expirado",
        cartela: null
      });
    }

    return res.json({
      sucesso: true,
      status_interno: "pendente",
      cartela: null
    });

  } catch (erro) {

    console.error("[PIX] ERRO VERIFICAR PAGAMENTO CARTELA:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro ao verificar pagamento da cartela."
    });
  }
});

/* =====================================================
   ADMIN — BUSCAR CARTELA POR NÚMERO
   Usado na conferência do sorteio (qual número foi
   sorteado, quem pagou e quando).
===================================================== */
app.get("/admin/cartelas/buscar/:numero", exigirPagina("cartelas"), async (req, res) => {
  try {

    const { numero } = req.params;
    const numeroNormalizado = normalizarNumeroDigitado(numero);

    const { data: cartela, error } = await supabase
      .from("cartelas")
      .select("*")
      .or(`numero_chance1.eq.${numero},numero_chance2.eq.${numero},numero_chance1.eq.${numeroNormalizado},numero_chance2.eq.${numeroNormalizado}`)
      .maybeSingle();

    if (error) {
      console.error("[ADMIN] ERRO BUSCAR CARTELA ADMIN:", error);
      return res.status(500).json({
        sucesso: false,
        erro: "Erro ao buscar cartela."
      });
    }

    if (!cartela) {
      return res.status(404).json({
        sucesso: false,
        erro: "Cartela não encontrada."
      });
    }

    return res.json({
      sucesso: true,
      cartela
    });

  } catch (erro) {

    console.error("[ADMIN] ERRO INTERNO BUSCAR CARTELA ADMIN:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao buscar cartela."
    });
  }
});

/* =====================================================================
   ADMIN — CARTELAS: FILTROS, PAGINAÇÃO E CONTAGENS
   O Supabase devolve no máximo 1.000 linhas por consulta, então
   a listagem busca em páginas e os totais vêm de contagens no banco.
===================================================================== */
const COLUNAS_LISTA_CARTELAS =
  "id,numero_chance1,numero_chance2,tipo,lote,status,nome_comprador,cpf_comprador,whatsapp_comprador,valor_pago,vai_na_festa,reservado_em,data_pagamento,comprovante_id,pdf_url,pix_id";

function filtrosCartelasDaQuery(query) {
  // sem lote na query = "todos" (não existe mais um único "lote ativo"
  // global desde que física e digital passaram a poder ter lotes
  // diferentes — ver lotes_cartelas)
  const lote = String(query.lote || "").trim();
  const busca = String(query.busca || "").trim();

  return {
    loteRotulo: lote,
    lote: lote === "todos" ? null : lote,
    tipo: ["fisica", "digital"].includes(query.tipo) ? query.tipo : null,
    status: ["disponivel", "pendente", "pago", "cancelado"].includes(query.status)
      ? query.status
      : null,
    vai_na_festa: ["sim", "talvez", "nao"].includes(query.presenca) ? query.presenca : null,
    // usado tanto pelo resumo (sem busca) quanto pela listagem/exportação
    busca: busca || null
  };
}

function aplicarFiltrosCartelas(consulta, filtros) {
  if (filtros.lote) consulta = consulta.eq("lote", filtros.lote);
  if (filtros.lotes && filtros.lotes.length) consulta = consulta.in("lote", filtros.lotes);
  if (filtros.tipo) consulta = consulta.eq("tipo", filtros.tipo);
  if (filtros.status) consulta = consulta.eq("status", filtros.status);
  if (filtros.vai_na_festa) consulta = consulta.eq("vai_na_festa", filtros.vai_na_festa);

  if (filtros.busca) {
    // mesmos 4 campos que a busca livre do admin já comparava no navegador
    // (nome, CPF, número em qualquer uma das 2 chances) — "%"/"," não tem
    // uso legítimo nesses campos, então são removidos por segurança do filtro
    const termo = filtros.busca.replace(/[%,()]/g, "");
    if (termo) {
      consulta = consulta.or(
        `nome_comprador.ilike.%${termo}%,cpf_comprador.ilike.%${termo}%,` +
        `numero_chance1.ilike.%${termo}%,numero_chance2.ilike.%${termo}%`
      );
    }
  }

  return consulta;
}

async function contarCartelas(filtros) {
  const { count, error } = await aplicarFiltrosCartelas(
    supabase.from("cartelas").select("id", { count: "exact", head: true }),
    filtros
  );

  if (error) throw error;
  return count || 0;
}

function ordenarCartelasMaisRecentes(consulta) {
  // mais recentes primeiro: pagamento, depois reserva (ainda nao pagas) e por fim o id
  return consulta
    .order("data_pagamento", { ascending: false, nullsFirst: false })
    .order("reservado_em", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });
}

// Uma página real (offset = (pagina-1)*porPagina), pra navegação no admin
async function buscarPaginaCartelas(filtros, pagina, porPagina) {
  const inicio = (pagina - 1) * porPagina;
  const fim = inicio + porPagina - 1;

  const { data, error } = await ordenarCartelasMaisRecentes(
    aplicarFiltrosCartelas(supabase.from("cartelas").select(COLUNAS_LISTA_CARTELAS), filtros)
  ).range(inicio, fim);

  if (error) throw error;
  return data;
}

// TODAS as linhas do filtro, sem limite — só pra exportação de CSV (o Supabase
// limita 1.000 por consulta, então busca em páginas até esgotar)
async function listarTodasCartelasFiltro(filtros) {
  const TAMANHO_PAGINA = 1000;
  const resultado = [];

  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const { data, error } = await ordenarCartelasMaisRecentes(
      aplicarFiltrosCartelas(supabase.from("cartelas").select(COLUNAS_LISTA_CARTELAS), filtros)
    ).range(inicio, inicio + TAMANHO_PAGINA - 1);

    if (error) throw error;

    resultado.push(...data);
    if (data.length < TAMANHO_PAGINA) break;
  }

  return resultado;
}

async function somarValorPagoCartelas(filtros) {
  const TAMANHO_PAGINA = 1000;
  let soma = 0;

  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const { data, error } = await aplicarFiltrosCartelas(
      supabase.from("cartelas").select("valor_pago"),
      { ...filtros, status: "pago" }
    )
      .order("id", { ascending: true })
      .range(inicio, inicio + TAMANHO_PAGINA - 1);

    if (error) throw error;

    soma += data.reduce((acc, c) => acc + Number(c.valor_pago || 0), 0);
    if (data.length < TAMANHO_PAGINA) break;
  }

  return Math.round(soma * 100) / 100;
}

// Lista os lotes existentes sem varrer a tabela: pula de um lote pro próximo
// (o índice idx_cartelas_lote torna cada consulta instantânea)
async function listarLotesCartelas() {
  const lotes = [];
  let anterior = null;

  for (let i = 0; i < 50; i++) {
    let consulta = supabase.from("cartelas").select("lote").order("lote", { ascending: true }).limit(1);
    if (anterior !== null) consulta = consulta.gt("lote", anterior);

    const { data, error } = await consulta;
    if (error) throw error;
    if (!data.length) break;

    anterior = data[0].lote;
    lotes.push(anterior);
  }

  return lotes;
}

/* =====================================================================
   ADMIN — LISTAR CARTELAS (filtro por lote, padrão: todos)
===================================================================== */
app.get("/admin/cartelas", exigirPagina("cartelas"), async (req, res) => {
  try {

    const filtros = filtrosCartelasDaQuery(req.query);

    const porPaginaSolicitado = Number(req.query.porPagina);
    const porPagina = Math.min(
      Number.isInteger(porPaginaSolicitado) && porPaginaSolicitado > 0 ? porPaginaSolicitado : 100,
      1000
    );

    // contagem e lista de lotes não dependem uma da outra — em paralelo,
    // menos uma ida-e-volta ao banco por requisição
    const [totalNoFiltro, lotes] = await Promise.all([
      contarCartelas(filtros),
      listarLotesCartelas()
    ]);
    const totalPaginas = Math.max(1, Math.ceil(totalNoFiltro / porPagina));

    const paginaSolicitada = Number(req.query.pagina);
    const pagina = Math.min(
      Math.max(Number.isInteger(paginaSolicitada) && paginaSolicitada > 0 ? paginaSolicitada : 1, 1),
      totalPaginas
    );

    const cartelas = await buscarPaginaCartelas(filtros, pagina, porPagina);

    return res.json({
      sucesso: true,
      total: cartelas.length,
      total_no_filtro: totalNoFiltro,
      pagina,
      por_pagina: porPagina,
      total_paginas: totalPaginas,
      lote_aplicado: filtros.loteRotulo,
      lotes,
      cartelas
    });

  } catch (erro) {

    console.error("[ERROR] ERRO INTERNO LISTAR CARTELAS:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao listar cartelas."
    });
  }
});

/* =====================================================================
   ADMIN — EXPORTAR CARTELAS EM CSV
   Mesmos filtros da listagem (lote/tipo/status/presença/busca), mas sem
   paginação — todas as linhas que baterem com o filtro, não só a página
   visível na tela.
===================================================================== */
app.get("/admin/cartelas/exportar", exigirPagina("cartelas"), async (req, res) => {
  try {

    const filtros = filtrosCartelasDaQuery(req.query);

    const cartelas = await listarTodasCartelasFiltro(filtros);

    const cabecalho = [
      "ID",
      "Número Chance 1",
      "Número Chance 2",
      "Tipo",
      "Lote",
      "Status",
      "Nome",
      "CPF",
      "WhatsApp",
      "Valor Pago",
      "Vai à Festa",
      "Data Reserva",
      "Data Pagamento",
      "Comprovante"
    ];

    const escaparCSV = (valor) => `"${String(valor).replace(/"/g, '""')}"`;

    const linhas = cartelas.map((c) => [
      c.id || "",
      c.numero_chance1 || "",
      c.numero_chance2 || "",
      c.tipo || "",
      c.lote || "",
      c.status || "",
      c.nome_comprador || "",
      c.cpf_comprador || "",
      c.whatsapp_comprador || "",
      c.valor_pago || "",
      c.vai_na_festa || "",
      c.reservado_em || "",
      c.data_pagamento || "",
      c.comprovante_id || ""
    ]);

    let csv = cabecalho.map(escaparCSV).join(";") + "\n";
    linhas.forEach((linha) => {
      csv += linha.map(escaparCSV).join(";") + "\n";
    });

    const hoje = new Date();
    const nomeArquivo =
      `cartelas-fpss-${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
    return res.send("﻿" + csv);

  } catch (erro) {

    console.error("[ERROR] ERRO EXPORTAR CARTELAS CSV:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao exportar cartelas."
    });
  }
});

/* =====================================================================
   ADMIN — RESUMO/ESTATÍSTICAS DE CARTELAS (cards do topo da página)
   Respeita o mesmo filtro de lote da listagem (padrão: lote ativo) e
   usa contagens no banco, sem baixar as linhas (o Supabase limita a
   1.000 linhas por consulta).
===================================================================== */
app.get("/admin/cartelas/resumo", exigirPagina("cartelas"), async (req, res) => {
  try {

    const base = filtrosCartelasDaQuery({ lote: req.query.lote });

    // ?lotes=a,b → totais de vários lotes juntos (os cards do admin)
    const lotes = String(req.query.lotes || "")
      .split(",").map(l => l.trim()).filter(Boolean).slice(0, 50);
    if (lotes.length) {
      base.lote = null;
      base.lotes = lotes;
      base.loteRotulo = lotes.join(",");
    }

    const [
      total,
      pagas,
      pendentes,
      disponiveis,
      fisicasPagas,
      digitaisPagas,
      confirmaramPresenca
    ] = await Promise.all([
      contarCartelas(base),
      contarCartelas({ ...base, status: "pago" }),
      contarCartelas({ ...base, status: "pendente" }),
      contarCartelas({ ...base, status: "disponivel" }),
      contarCartelas({ ...base, status: "pago", tipo: "fisica" }),
      contarCartelas({ ...base, status: "pago", tipo: "digital" }),
      contarCartelas({ ...base, status: "pago", vai_na_festa: "sim" })
    ]);

    const receitaTotal = await somarValorPagoCartelas(base);

    return res.json({
      sucesso: true,
      lote_aplicado: base.loteRotulo,
      total_cartelas: total,
      total_pagas: pagas,
      total_pendentes: pendentes,
      total_disponiveis: disponiveis,
      fisicas_pagas: fisicasPagas,
      digitais_pagas: digitaisPagas,
      confirmaram_presenca: confirmaramPresenca,
      receita_total: receitaTotal
    });

  } catch (erro) {

    console.error("[ERROR] ERRO RESUMO CARTELAS:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao gerar resumo de cartelas."
    });
  }
});

/* =====================================================================
   ADMIN — LOTES DE CARTELAS (remessas)
   Cada tipo (física/digital) tem no máximo um lote ativo por vez —
   é o que a rota de compra usa pra saber qual "lote" da tabela
   cartelas vender e por qual preço (ver buscarLoteAtivo em
   src/services/cartelas/lotes.js). Essas rotas só mexem na tabela
   lotes_cartelas e, na importação, em NOVAS linhas de "cartelas"
   (nunca alteram cartelas existentes).
===================================================================== */

const uploadPlanilha = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // planilhas de milhares de linhas cabem tranquilo em 15MB
});

const CHAVE_LOTE_VALIDA = /^[a-z0-9][a-z0-9_-]{2,49}$/;

/* ===== LISTAR LOTES (com contagem ao vivo de disponíveis/pendentes/pagas) ===== */
app.get("/admin/lotes", exigirPagina("lotes"), async (req, res) => {
  try {

    const { data: lotes, error } = await supabase
      .from("lotes_cartelas")
      .select("*")
      .order("tipo", { ascending: true })
      .order("criado_em", { ascending: true });

    if (error) throw error;

    const lotesComContagem = await Promise.all(
      (lotes || []).map(async (lote) => {
        const [disponiveis, pendentes, pagas] = await Promise.all([
          supabase.from("cartelas").select("id", { count: "exact", head: true })
            .eq("lote", lote.chave).eq("tipo", lote.tipo).eq("status", "disponivel"),
          supabase.from("cartelas").select("id", { count: "exact", head: true })
            .eq("lote", lote.chave).eq("tipo", lote.tipo).eq("status", "pendente"),
          supabase.from("cartelas").select("id", { count: "exact", head: true })
            .eq("lote", lote.chave).eq("tipo", lote.tipo).eq("status", "pago")
        ]);

        return {
          ...lote,
          disponiveis: disponiveis.count || 0,
          pendentes: pendentes.count || 0,
          pagas: pagas.count || 0
        };
      })
    );

    return res.json({ sucesso: true, lotes: lotesComContagem });

  } catch (erro) {
    console.error("[ADMIN] ERRO LISTAR LOTES:", erro);
    return res.status(500).json({ sucesso: false, erro: "Erro interno ao listar lotes." });
  }
});

/* ===== CRIAR LOTE (só metadados — nenhuma cartela ainda) ===== */
app.post("/admin/lotes", exigirPagina("lotes"), async (req, res) => {
  try {

    const { chave, tipo, descricao, valor_centavos, quantidade_total } = req.body || {};

    const chaveLimpa = String(chave || "").trim().toLowerCase();

    if (!CHAVE_LOTE_VALIDA.test(chaveLimpa)) {
      return res.status(400).json({
        sucesso: false,
        erro: "Identificador do lote inválido. Use só letras minúsculas, números, hífen e underscore (3-50 caracteres), ex: remessa_02_fisica."
      });
    }

    if (!["fisica", "digital"].includes(tipo)) {
      return res.status(400).json({ sucesso: false, erro: "Tipo deve ser \"fisica\" ou \"digital\"." });
    }

    const centavos = Number(valor_centavos);
    if (!Number.isInteger(centavos) || centavos <= 0) {
      return res.status(400).json({ sucesso: false, erro: "Valor (em centavos) deve ser um número inteiro maior que zero." });
    }

    const qtdTotal = quantidade_total === undefined || quantidade_total === null || quantidade_total === ""
      ? null
      : Number(quantidade_total);

    if (qtdTotal !== null && (!Number.isInteger(qtdTotal) || qtdTotal < 0)) {
      return res.status(400).json({ sucesso: false, erro: "Quantidade total deve ser um número inteiro." });
    }

    const { data, error } = await supabase
      .from("lotes_cartelas")
      .insert({
        chave: chaveLimpa,
        tipo,
        descricao: sanitizarTexto(descricao, 200) || null,
        valor_centavos: centavos,
        quantidade_total: qtdTotal,
        ativo: false
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") { // unique_violation (chave, tipo)
        return res.status(409).json({ sucesso: false, erro: "Já existe um lote com esse identificador e tipo." });
      }
      throw error;
    }

    return res.status(201).json({ sucesso: true, lote: data });

  } catch (erro) {
    console.error("[ADMIN] ERRO CRIAR LOTE:", erro);
    return res.status(500).json({ sucesso: false, erro: "Erro interno ao criar lote." });
  }
});

/* ===== ATIVAR LOTE (desativa qualquer outro do mesmo tipo) ===== */
app.post("/admin/lotes/:id/ativar", exigirPagina("lotes"), async (req, res) => {
  try {

    const { id } = req.params;

    const { data: lote, error: erroBusca } = await supabase
      .from("lotes_cartelas").select("*").eq("id", id).maybeSingle();

    if (erroBusca) throw erroBusca;
    if (!lote) return res.status(404).json({ sucesso: false, erro: "Lote não encontrado." });

    const { error: erroDesativar } = await supabase
      .from("lotes_cartelas")
      .update({ ativo: false, atualizado_em: new Date().toISOString() })
      .eq("tipo", lote.tipo)
      .eq("ativo", true)
      .neq("id", id);

    if (erroDesativar) throw erroDesativar;

    const { data: loteAtivado, error: erroAtivar } = await supabase
      .from("lotes_cartelas")
      .update({ ativo: true, atualizado_em: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (erroAtivar) throw erroAtivar;

    console.log(`[ADMIN] Lote ativado: ${loteAtivado.chave} (${loteAtivado.tipo})`);

    return res.json({ sucesso: true, lote: loteAtivado });

  } catch (erro) {
    console.error("[ADMIN] ERRO ATIVAR LOTE:", erro);
    return res.status(500).json({ sucesso: false, erro: "Erro interno ao ativar lote." });
  }
});

/* ===== DESATIVAR LOTE ===== */
app.post("/admin/lotes/:id/desativar", exigirPagina("lotes"), async (req, res) => {
  try {

    const { id } = req.params;

    const { data: lote, error } = await supabase
      .from("lotes_cartelas")
      .update({ ativo: false, atualizado_em: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!lote) return res.status(404).json({ sucesso: false, erro: "Lote não encontrado." });

    console.log(`[ADMIN] Lote desativado: ${lote.chave} (${lote.tipo})`);

    return res.json({ sucesso: true, lote });

  } catch (erro) {
    console.error("[ADMIN] ERRO DESATIVAR LOTE:", erro);
    return res.status(500).json({ sucesso: false, erro: "Erro interno ao desativar lote." });
  }
});

/* =====================================================================
   IMPORTAR CARTELAS PRA UM LOTE — planilha (.xlsx/.csv) com as colunas:
     física:  numero_chance1, numero_chance2       (formato NNNNN-DD)
     digital: numero_chance1, numero_chance2, grade_chance1, grade_chance2
              (grade = 24 números separados por vírgula, ordem S-O-R-T-E)

   modo=validar (padrão): só analisa e devolve um relatório, NADA é gravado.
   modo=confirmar: grava — só se a validação (rodada de novo, sempre, nunca
   confia numa validação anterior) não encontrar NENHUMA linha inválida.
   A gravação é uma única inserção (todas as linhas de uma vez), que no
   Postgres é atômica: ou entra tudo, ou não entra nada.
===================================================================== */
app.post("/admin/lotes/:id/importar", exigirPagina("lotes"), uploadPlanilha.single("planilha"), async (req, res) => {
  try {

    const { id } = req.params;
    const modo = req.query.modo === "confirmar" ? "confirmar" : "validar";

    if (!req.file) {
      return res.status(400).json({ sucesso: false, erro: "Nenhuma planilha enviada." });
    }

    const { data: lote, error: erroLote } = await supabase
      .from("lotes_cartelas").select("*").eq("id", id).maybeSingle();

    if (erroLote) throw erroLote;
    if (!lote) return res.status(404).json({ sucesso: false, erro: "Lote não encontrado." });

    let resultado;
    try {
      resultado = await processarPlanilha(req.file.buffer, { loteChave: lote.chave, tipo: lote.tipo });
    } catch (erroLeitura) {
      console.error("[ADMIN] ERRO LER PLANILHA DE LOTE:", erroLeitura);
      return res.status(400).json({ sucesso: false, erro: "Não foi possível ler a planilha. Confira se é um .xlsx válido." });
    }

    if (!resultado.total_linhas) {
      return res.status(400).json({ sucesso: false, erro: "A planilha está vazia." });
    }

    const { validas, invalidas } = resultado;

    const relatorio = {
      total_linhas: resultado.total_linhas,
      validas: validas.length,
      invalidas: invalidas.length,
      erros: invalidas.slice(0, 50), // não devolve milhares de erros de uma vez
      amostra: validas.slice(0, 5)
    };

    if (modo === "validar" || invalidas.length > 0) {
      return res.json({ sucesso: true, gravado: false, relatorio });
    }

    /* ===== GRAVAÇÃO — uma inserção só, atômica ===== */
    const { error: erroInsert } = await supabase.from("cartelas").insert(validas);

    if (erroInsert) {
      console.error("[ADMIN] ERRO GRAVAR IMPORTACAO DE LOTE:", erroInsert);

      const duplicado = erroInsert.code === "23505";

      return res.status(409).json({
        sucesso: false,
        gravado: false,
        erro: duplicado
          ? "Um ou mais números dessa planilha já existem em outra cartela do sistema (nenhuma linha foi gravada — a operação é tudo-ou-nada)."
          : "Erro ao gravar a importação (nenhuma linha foi gravada).",
        detalhe: erroInsert.message
      });
    }

    console.log(`[ADMIN] Importação confirmada: ${validas.length} cartelas novas no lote ${lote.chave} (${lote.tipo})`);

    return res.json({ sucesso: true, gravado: true, relatorio });

  } catch (erro) {
    console.error("[ADMIN] ERRO IMPORTAR LOTE:", erro);
    return res.status(500).json({ sucesso: false, erro: "Erro interno ao importar planilha." });
  }
});


/* =====================================================
   CONFERÊNCIA AUTOMÁTICA DAS CARTELAS PENDENTES (2026-10-04)
   A cada 2 minutos consulta na Sicredi o Pix de toda cartela
   "pendente":
   - pago  → marca como paga (e gera a cartela digital), mesmo que
             o cliente tenha fechado a tela antes da confirmação;
   - não pago e reserva vencida → libera de volta pro estoque.
   Só libera se TODAS as consultas da rodada deram certo — se a
   Sicredi falhar, nada é liberado (melhor esperar a próxima rodada
   do que apagar uma cartela que pode ter sido paga).
===================================================== */
let conferenciaCartelasRodando = false;

async function conferirCartelasPendentes() {
  if (conferenciaCartelasRodando) return { sucesso: false, erro: "Conferência já em andamento." };
  conferenciaCartelasRodando = true;
  const resumo = { conferidas: 0, confirmadas_pagas: 0, falhas: 0, liberacao_executada: false };

  try {
    const { data: pendentes, error } = await supabase
      .from("cartelas")
      .select("*")
      .eq("status", "pendente")
      .not("pix_id", "is", null)
      .order("reservado_em", { ascending: true })
      .limit(150);
    if (error) throw error;

    for (const cartela of pendentes || []) {
      const txid = cartela.pix_id;
      try {
        const pagamento = await consultarPix(txid);
        resumo.conferidas++;
        if (!pagamento || pagamento.status !== "CONCLUIDA") continue;

        const { data: atualizadas, error: erroUpdate } = await supabase
          .from("cartelas")
          .update({
            status: "pago",
            data_pagamento: new Date().toISOString(),
            comprovante_id: `COMP-${txid}`
          })
          .eq("id", cartela.id)
          .eq("status", "pendente")
          .eq("pix_id", txid)
          .select("*");
        if (erroUpdate) { resumo.falhas++; console.error("[CONF-CARTELAS] erro ao marcar paga:", erroUpdate); continue; }
        if (!atualizadas || !atualizadas.length) continue; // outra rota já confirmou

        resumo.confirmadas_pagas++;
        console.log(`[CONF-CARTELAS] cartela ${cartela.id} (${cartela.numero_chance1}) confirmada como PAGA pela conferência automática — txid=${txid}`);

        const paga = atualizadas[0];
        if (paga.tipo === "digital" && !paga.pdf_url && !cartelasDigitaisEmGeracao.has(txid)) {
          cartelasDigitaisEmGeracao.add(txid);
          gerarEGuardarCartelaDigital(paga, txid)
            .catch(e => console.error("[CONF-CARTELAS] erro ao gerar cartela digital:", e))
            .finally(() => cartelasDigitaisEmGeracao.delete(txid));
        }
      } catch (erroConsulta) {
        resumo.falhas++;
        console.error(`[CONF-CARTELAS] falha ao consultar txid=${txid}:`, erroConsulta?.response?.status || erroConsulta?.message || erroConsulta);
      }
    }

    if (resumo.falhas === 0) {
      const { error: erroLiberar } = await supabase.rpc("liberar_cartelas_expiradas");
      if (erroLiberar) console.error("[CONF-CARTELAS] erro ao liberar expiradas:", erroLiberar);
      else resumo.liberacao_executada = true;
    } else {
      console.warn(`[CONF-CARTELAS] ${resumo.falhas} consulta(s) falharam — liberação de expiradas adiada para a próxima rodada.`);
    }

    return { sucesso: true, ...resumo };
  } catch (erro) {
    console.error("[CONF-CARTELAS] erro geral:", erro);
    return { sucesso: false, erro: "Erro ao conferir cartelas pendentes.", ...resumo };
  } finally {
    conferenciaCartelasRodando = false;
  }
}

// botão "Conferir Pix pendentes" do admin de cartelas
app.post("/admin/cartelas/conferir-pendentes", exigirPagina("cartelas"), async (req, res) => {
  const r = await conferirCartelasPendentes();
  return res.status(r.sucesso ? 200 : 500).json(r);
});

/* =====================================================
   VENDAS: carrinho, estoque, caixa, reembolso (src/vendas/vendas.js)
===================================================== */
vendas.registrarRotasVendas(app, {
  supabase,
  criarPix,
  consultarPix,
  verificarAdminBackend,
  exigirPagina,
  verificarAcessoRetirada: verificarAcessoCaixa,
  limitadorOperador,
  sanitizarTexto,
  codigoPedidoValido
});

/* =====================================================
   DISTRIBUIÇÃO DE BLOCOS DE CARTELAS (src/blocos/blocos.js)
===================================================== */
registrarRotasBlocos(app, { supabase, limitadorOperador, paginasDoUsuario, PAPEIS_VALIDOS });

/* Confere sozinho, a cada 2 minutos, os Pix de produtos ainda pendentes
   (quem pagou e fechou a página antes da confirmação). */
if (process.env.DESATIVAR_CONFERENCIA_PIX !== "1") {
  vendas.iniciarConferenciaAutomatica(supabase, consultarPix);

  // cartelas: primeira rodada 30s depois de subir, depois a cada 2 min
  setTimeout(conferirCartelasPendentes, 30 * 1000);
  setInterval(conferirCartelasPendentes, 2 * 60 * 1000);
}

app.listen(PORT, () => {
  console.log(`[INFO] Servidor FPSS PRO rodando na porta ${PORT}`);
});


app.get("/sicredi/teste-pix", limitadorPix, async (req, res) => {

    try {

        const pix = await criarPix(
            0.15,
            "Marcos Belgamazzi",
            "71117881253"
        );

        res.json(pix);

    } catch (e) {

        console.error(e.response?.data || e.message);

        res.status(500).json(
            e.response?.data || e.message
        );

    }

});

/* =====================================================
   404 + ERRO GLOBAL
   Precisam ser os ÚLTIMOS middlewares registrados — o Express só chega
   até aqui se nenhuma rota acima bateu (404) ou se algo chamou next(err)
   / lançou dentro de um handler async (erro global). Sem isso, uma
   exceção fora de um try/catch usava o handler padrão do Express (que
   pode vazar stack trace) em vez de uma resposta JSON consistente com o
   resto da API.
===================================================== */
app.use((req, res) => {
  res.status(404).json({
    sucesso: false,
    erro: "Rota não encontrada."
  });
});

app.use((err, req, res, next) => {
  console.error("[ERROR] ERRO GLOBAL NÃO TRATADO:", err);

  if (res.headersSent) return next(err);

  res.status(err.status || 500).json({
    sucesso: false,
    erro: "Erro interno no servidor."
  });
});
const express = require("express");
const cors = require("cors");
const path = require("path");
const { gerarCartelaDigitalPNG } = require("./src/services/cartelas/gerar-cartela-digital");
const { uploadCartelaDigital } = require("./src/services/cartelas/upload-cartela-storage");
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

//const vipRoutes = require("./vip.routes");
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
app.use(cors({
  origin: function (origin, callback) {
    

    if (!origin) return callback(null, true);

if (
  allowedOrigins.includes(origin) ||
  origin.includes("vercel.app")
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
   BODY + ARQUIVOS ESTÁTICOS
===================================================== */
app.use(express.json({ limit: "10mb" }));
//app.use("/api/vip", vipRoutes);


// app.use("/css", express.static(path.join(__dirname, "css")));
// app.use("/js", express.static(path.join(__dirname, "js")));
// app.use("/assets", express.static(path.join(__dirname, "assets")));

// app.use("/venda", express.static(path.join(__dirname, "venda")));
// app.use("/doacao", express.static(path.join(__dirname, "doacao")));
// app.use("/enquete", express.static(path.join(__dirname, "enquete")));

//app.use("/admin", express.static(path.join(__dirname, "front-end", "admin")));



// ... (resto do seu código do server.js original) ...


/* =====================================================
   SUPABASE
===================================================== */
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error("ERRO: Credenciais Supabase ausentes.");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/* =====================================================
   TESTE TOKEN SICREDI
===================================================== */


app.get("/sicredi/token", async (req, res) => {

  try {

    const token = await getAccessToken();

    return res.json({
      sucesso: true,
      access_token: token
    });

  } catch (error) {

    console.error("ERRO SICREDI:");

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
app.post("/criar-pix", async (req, res) => {
  try {
const {
  nome,
  sobrenome,
  cpf,
  telefone,
  quantidade,
  horario_retirada,
  email,

  produto_codigo
} = req.body;

const cpfLimpo = limparCPF(cpf);
const telefoneLimpo = limparTelefone(telefone);

if (!validarCPF(cpfLimpo)) {
  return res.status(400).json({
    sucesso: false,
    erro: "CPF inválido."
  });
}

/* =====================================================
   BUSCAR PRODUTO
===================================================== */

const codigoProduto =
  String(produto_codigo || "")
    .trim()
    .toUpperCase();

if (!codigoProduto) {

  return res.status(400).json({
    sucesso: false,
    erro: "Produto não informado."
  });

}

const { data: produto, error: produtoError } =
  await supabase
    .from("produtos")
    .select("*")
    .eq("codigo", codigoProduto)
    .single();

if (produtoError || !produto) {

  return res.status(404).json({
    sucesso: false,
    erro: "Produto não encontrado."
  });
}

const produtoTipo = produto.codigo;

const precoUnitario =
  Number(produto.preco || 0);

const quantidadeNumerica =
  Number(quantidade || 1);

const total =
  precoUnitario * quantidadeNumerica;


    /* =====================================================
       GERAR CÓDIGO OFICIAL
    ===================================================== */
    const anoEvento = "2027";
    

    const { data: ultimoPedido } = await supabase
      .from("pedidos")
      .select("id")
      .order("id", { ascending: false })
      .limit(1);

    const numeroSequencial = ultimoPedido && ultimoPedido.length > 0
      ? ultimoPedido[0].id + 1
      : 1;

    const codigoPedido = `FPSS-${anoEvento}-${produtoTipo}-${String(numeroSequencial).padStart(6, "0")}`;


/* =====================================================
   SICREDI PIX
===================================================== */

const pagamento = await criarPix(

  total,

  `${nome} ${sobrenome || ""}`.trim(),

  cpfLimpo

);


   /* =====================================================
   SALVAR PEDIDO
===================================================== */
const pedidoData = {
  nome,
  sobrenome: sobrenome || "",
  cpf: cpfLimpo,
  telefone: telefoneLimpo || "nao informado",
  email: email || null,

  produto_tipo: produtoTipo,
  
  codigo_pedido: codigoPedido,

  quantidade: quantidadeNumerica,
  horario_retirada: horario_retirada || null,

  valor_total: total,


txid: pagamento.txid,

pix_copia_cola: pagamento.pixCopiaECola || null,



  status_pagamento: "pendente",

status_retirada: "pendente",

  /* IMPORTANTE:
     QR/TOKEN DE RETIRADA NÃO DEVEM SER LIBERADOS AINDA.
     SERÃO GERADOS SOMENTE APÓS CONFIRMAÇÃO DO PAGAMENTO. */
  qr_code_retirada: null,
  token_retirada: null,

  status: "pendente"
};

const { data: pedidoSalvo, error: supabaseError } = await supabase
  .from("pedidos")
  .insert([pedidoData])
  .select();

if (supabaseError) {
  console.error("Erro Supabase:", supabaseError);

  return res.status(500).json({
    sucesso: false,
    erro: "Erro ao salvar pedido."
  });
}

return res.status(200).json({

    sucesso: true,

    mensagem: "PIX gerado com sucesso.",

    txid: pagamento.txid,

    codigo_pedido: codigoPedido,

    produto_tipo: produtoTipo,

    produto_codigo: produto.codigo,

    produto_nome: produto.nome,

    produto_imagem: produto.imagem,
    produto_descricao: produto.descricao,

produto_preco_unitario: precoUnitario,

    quantidade: quantidadeNumerica,

    total: total,

    pix_copia_cola: pagamento.pixCopiaECola,

    qr_code_base64: pagamento.qrCodeBase64,

    pedido: pedidoSalvo

});

} catch (erro) {
  console.error("ERRO AO GERAR PIX:", erro);

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
      console.error("Erro interno Supabase VIP:", error);

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
    console.error("Erro crítico na rota VIP:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno no servidor."
    });
  }
});


/* =====================================================
   VERIFICAR PAGAMENTO 
===================================================== */
app.get("/verificar-pagamento/:txid", async (req, res) => {
  
  
  try {

    const { txid } = req.params;
    const pagamento = await consultarPix(txid);



    const statusPagamento = pagamento.status;


    /* =========================================
       PAGAMENTO APROVADO
    ========================================= */
    if (statusPagamento === "CONCLUIDA") {

const { data: pedido, error: pedidoError } = await supabase
  .from("pedidos")
  .select("*")
  .eq("txid", txid)
  .single();



if (pedidoError || !pedido) {
  return res.status(404).json({
    sucesso: false,
    erro: "Pedido não encontrado.",
    detalhe: pedidoError
  });
}

      let tokenRetirada = pedido.token_retirada;
      let qrCodeRetirada = pedido.qr_code_retirada;

      /* GERAR RETIRADA SE NÃO EXISTIR */
      if (!tokenRetirada || !qrCodeRetirada) {

tokenRetirada = `RET-${pedido.codigo_pedido}-${Date.now()}`
  .replaceAll(" ", "");

        qrCodeRetirada =
          `${pedido.codigo_pedido}|${pedido.cpf}|${tokenRetirada}`;

        const { error: updateError } = await supabase
          .from("pedidos")
.update({
  status_pagamento: "pago",
  status: "pago",
  data_pagamento: new Date(),
  token_retirada: tokenRetirada,
  qr_code_retirada: qrCodeRetirada
})
.eq("txid", txid)

        if (updateError) {
          console.error("Erro ao atualizar retirada:", updateError);
        }

      } else {

        await supabase
          .from("pedidos")
.update({
  status_pagamento: "pago",
  status: "pago",
  data_pagamento: new Date()
})
.eq("txid", txid)
      }

return res.json({
  sucesso: true,

  txid: txid,

  status: statusPagamento,

  status_interno: "pago",

  created_at: pedido.created_at,

  updated_at: new Date().toISOString(),

  data_pagamento:
    pedido.data_pagamento || new Date().toISOString(),

  token_retirada: tokenRetirada,

  qr_code_retirada: qrCodeRetirada
});
    }

    /* =========================================
       QUALQUER STATUS NÃO APROVADO
    ========================================= */
    await supabase
      .from("pedidos")
.update({
  status_pagamento: "pendente"
})
.eq("txid", txid)

    return res.json({
      sucesso: true,
      txid: txid,
      status: statusPagamento,
      status_interno: "pendente"
    });

  } catch (erro) {

    console.error("Erro verificar pagamento:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro ao verificar pagamento."
    });
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
            "ERRO RECUPERAR PIX:",
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
app.get("/pedido/:orderId", async (req, res) => {
  try {
   const { orderId } = req.params;

const { data, error } = await supabase
  .from("pedidos")
  .select("*")
  .eq("txid", orderId)
  .single();

    if (error || !data) {
      return res.status(404).json({
        sucesso: false,
        erro: "Pedido não encontrado."
      });
    }

    return res.json({
      sucesso: true,
      pedido: data
    });

  } catch (erro) {
    return res.status(500).json({
      sucesso: false,
      erro: "Erro ao consultar pedido."
    });
  }
});

/* =====================================================
   CONSULTAR POR CÓDIGO OFICIAL
===================================================== */
app.get("/pedido/codigo/:codigoPedido", async (req, res) => {
  try {
    const { codigoPedido } = req.params;

    const { data, error } = await supabase
      .from("pedidos")
      .select("*")
      .eq("codigo_pedido", codigoPedido)
      .single();

    if (error || !data) {
      return res.status(404).json({
        sucesso: false,
        erro: "Código não encontrado."
      });
    }

    return res.json({
      sucesso: true,
      pedido: data
    });

  } catch (erro) {
    return res.status(500).json({
      sucesso: false,
      erro: "Erro ao buscar código."
    });
  }
});

/* =====================================================
   CONSULTAR POR CPF
===================================================== */
app.get("/pedido/cpf/:cpf", async (req, res) => {
  try {

    const cpf = limparCPF(req.params.cpf);

    const { data, error } = await supabase
      .from("pedidos")
      .select("*")
      .eq("cpf", cpf)
      .order("id", { ascending: false });

    if (error || !data || !data.length) {
      return res.status(404).json({
        sucesso: false,
        erro: "CPF não encontrado."
      });
    }

    return res.json({
      sucesso: true,
      pedidos: data,
      total: data.length
    });

  } catch (erro) {

    return res.status(500).json({
      sucesso: false,
      erro: "Erro ao buscar CPF."
    });
  }
});

/* =====================================================
   CONFIRMAR RETIRADA
===================================================== */
app.post("/retirada/:codigoPedido", async (req, res) => {
  try {
    const { codigoPedido } = req.params;

    const { data: pedido, error: pedidoError } = await supabase
      .from("pedidos")
      .select("*")
      .eq("codigo_pedido", codigoPedido)
      .single();

    if (pedidoError || !pedido) {
      return res.status(404).json({
        sucesso: false,
        erro: "Pedido não encontrado."
      });
    }

    if (pedido.status_pagamento !== "pago") {
      return res.status(400).json({
        sucesso: false,
        erro: "Pagamento ainda não confirmado."
      });
    }

    if (pedido.status_retirada === "retirado") {
      return res.status(400).json({
        sucesso: false,
        erro: "Pedido já retirado."
      });
    }

    const { data, error } = await supabase
      .from("pedidos")
      .update({
        status_retirada: "retirado",
        data_retirada: new Date()
      })
      .eq("codigo_pedido", codigoPedido)
      .select();

    if (error) {
      return res.status(500).json({
        sucesso: false,
        erro: "Erro ao confirmar retirada."
      });
    }

    return res.json({
      sucesso: true,
      mensagem: "Retirada confirmada com sucesso.",
      pedido: data
    });

  } catch (erro) {
    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno."
    });
  }
});

/* =====================================================
   DASHBOARD ADMIN
===================================================== */
app.get("/admin/dashboard", verificarAdminBackend, async (req, res) => {
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
app.get("/admin/pedidos", verificarAdminBackend, async (req, res) => {
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
      .select("*")
      .eq("ativo", true)
      .order("ordem", { ascending: true });

    if (error) {
      return res.status(500).json({
        sucesso: false,
        erro: "Erro ao carregar produtos."
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
app.get("/admin/produtos", verificarAdminBackend, async (req, res) => {
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
app.post("/admin/produtos", verificarAdminBackend, async (req, res) => {
  
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
      ordem
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
      estoque: Number(estoque || 0),
      tipo: tipo ? String(tipo).trim() : "produto",
      imagem: imagem ? String(imagem).trim() : null,
      ordem: Number(ordem || 0),
      updated_at: new Date().toISOString()
    };

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
        console.error("ERRO BUSCA PRODUTO:", buscaErro);

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
              created_at: new Date().toISOString()
            }
          ])
          .select();
      }

    }

if (!resultado || resultado.error) {

  console.error("ERRO SALVAR PRODUTO:", resultado?.error || resultado);

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

  console.error("ERRO INTERNO ADMIN PRODUTOS DETALHADO:", erro);

  return res.status(500).json({
    sucesso: false,
    erro: erro.message || JSON.stringify(erro)
  });
}
});

/* =====================================================
   ADMIN PRODUTOS - EXCLUIR
===================================================== */
app.delete("/admin/produtos/:id", verificarAdminBackend, async (req, res) => {

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
      console.error("ERRO AO BUSCAR PRODUTO PARA EXCLUSÃO:", erroBusca);
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
      console.error("ERRO EXCLUIR PRODUTO:", error);

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
            console.error(`AVISO: produto ${id} excluído, mas falhou ao remover imagem "${nomeArquivo}" do Storage:`, erroStorage.message);
          } else {
            console.log(`Imagem "${nomeArquivo}" removida do Storage junto com o produto ${id}.`);
          }
        }
      } catch (erroParse) {
        console.error(`AVISO: não foi possível interpretar a URL da imagem do produto ${id} para limpeza do Storage:`, erroParse.message);
      }
    }

    return res.json({
      sucesso: true,
      mensagem: "Produto excluído com sucesso."
    });

  } catch (erro) {

    console.error("ERRO INTERNO EXCLUIR PRODUTO:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: erro.message || "Erro interno ao excluir produto."
    });

  }

});

   


/* =====================================================
   ADMIN UPLOAD IMAGEM PRODUTO
===================================================== */
app.post("/admin/upload-imagem", verificarAdminBackend, upload.single("imagem"), async (req, res) => {
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
      console.error("ERRO UPLOAD:", uploadError);

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

    console.error("ERRO INTERNO UPLOAD:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: erro.message || "Erro interno upload."
    });
  }
});



/* =====================================================
   CENTRAL DO CLIENTE - LOGIN REAL
===================================================== */

app.post("/cliente-login", async (req, res) => {
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
      console.error("ERRO BUSCAR CARTELAS DO CLIENTE:", erroCartelas);
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

    const pedidosEnriquecidos = (data || []).map(pedido => {

      const produto = produtos?.find(
        p => p.codigo === pedido.produto_tipo
      );

      return {
        ...pedido,
        nome_produto: produto?.nome || pedido.produto_tipo,
        imagem_produto: produto?.imagem || null
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

    console.error("ERRO CLIENTE LOGIN:", erro);

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

app.get("/sicredi/teste-consulta/:txid", async (req, res) => {

  try {

    const { txid } = req.params;

    const resultado = await consultarPix(txid);

    return res.json(resultado);

  } catch (erro) {

    console.error(
      erro.response?.data || erro.message
    );

    return res.status(500).json(
      erro.response?.data || {
        erro: erro.message
      }
    );

  }

});



/* =====================================================
   ADMIN USUÁRIOS — MIDDLEWARE
   Confere se quem está chamando a rota é mesmo um admin
   autenticado, antes de deixar passar. Usa a service_role
   key (já configurada em SUPABASE_KEY) pra validar o token
   e consultar o perfil do usuário.
===================================================== */
async function verificarAdminBackend(req, res, next) {

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
      .select("role")
      .eq("id", userData.user.id)
      .single();

    if (perfilError || !perfil || perfil.role !== "admin") {
      return res.status(403).json({
        sucesso: false,
        erro: "Acesso restrito a administradores."
      });
    }

    req.usuarioAdmin = userData.user;
    next();

  } catch (erro) {

    console.error("ERRO VERIFICAR ADMIN BACKEND:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao verificar permissão."
    });

  }

}

/* =====================================================
   ADMIN USUÁRIOS — LISTAR
===================================================== */
app.get("/admin/usuarios", verificarAdminBackend, async (req, res) => {

  try {

    const { data, error } = await supabase
      .from("user_profiles")
      .select("id, nome, email, role, created_at")
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

    console.error("ERRO LISTAR USUARIOS:", erro);

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

    const { nome, email, password, role } = req.body || {};

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

    const roleFinal = role === "admin" ? "admin" : "padrao";

    const emailNormalizado = String(email).trim().toLowerCase();

    /* CRIA O USUÁRIO NO AUTH (exige service_role — já é a chave em uso) */
    const { data: novoUsuario, error: createError } =
      await supabase.auth.admin.createUser({
        email: emailNormalizado,
        password: String(password),
        email_confirm: true
      });

    if (createError) {
      console.error("ERRO CRIAR USUARIO AUTH:", createError);
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
        role: roleFinal
      }]);

    if (perfilError) {

      console.error("ERRO CRIAR PERFIL:", perfilError);

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

    console.error("ERRO INTERNO CRIAR USUARIO:", erro);

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
    const { nome, role } = req.body || {};

    if (!nome) {
      return res.status(400).json({
        sucesso: false,
        erro: "Nome é obrigatório."
      });
    }

    const roleFinal = role === "admin" ? "admin" : "padrao";

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
        role: roleFinal
      })
      .eq("id", id);

    if (error) {
      console.error("ERRO EDITAR USUARIO:", error);
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

    console.error("ERRO INTERNO EDITAR USUARIO:", erro);

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
      console.error("ERRO EXCLUIR USUARIO AUTH:", authError);
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

    console.error("ERRO INTERNO EXCLUIR USUARIO:", erro);

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
   CARTELAS — CONFIG (lote ativo, modo teste, valores)
===================================================== */
async function lerConfigCartelas() {
  const { data, error } = await supabase
    .from("cartelas_config")
    .select("chave, valor");

  if (error) {
    throw new Error(`Erro ao ler configuração de cartelas: ${error.message}`);
  }

  const config = {};
  for (const linha of data) {
    config[linha.chave] = linha.valor;
  }
  return config;
}

function calcularValorCartela(config) {
  const emModoTeste = config.modo_teste === "true";
  const centavos = emModoTeste
    ? Number(config.valor_teste_centavos || 1)
    : Number(config.valor_cartela_oficial_centavos || 2000);

  return centavos / 100;
}

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

    const config = await lerConfigCartelas();

    const { data: cartela, error } = await supabase
      .from("cartelas")
      .select("*")
      .eq("numero_chance1", String(numero).trim())
      .eq("tipo", "fisica")
      .eq("lote", config.lote_ativo)
      .maybeSingle();

    if (error) {
      console.error("ERRO VALIDAR NUMERO CARTELA:", error);
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

    return res.json({
      sucesso: true,
      valido: true
    });

  } catch (erro) {

    console.error("ERRO INTERNO VALIDAR NUMERO CARTELA:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao validar a cartela."
    });
  }
});

/* =====================================================
   CARTELAS — GERAR PIX (CARTELA FÍSICA)
===================================================== */
app.post("/cartelas/pix-fisica", async (req, res) => {
  try {

    const {
      numero_cartela,
      nome,
      cpf,
      telefone,
      vai_na_festa
    } = req.body;

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

    const config = await lerConfigCartelas();

    /* ===== LIBERA DE VOLTA PRO ESTOQUE QUALQUER RESERVA EXPIRADA
       (pendente há mais de 1h sem pagamento) ANTES de checar
       se esta cartela específica ainda está disponível ===== */
    await supabase.rpc("liberar_cartelas_expiradas");

    /* ===== VALIDAR A CARTELA DE NOVO (proteção no servidor,
       não confiar só na validação em tempo real do frontend) ===== */
    const { data: cartela, error: buscaErro } = await supabase
      .from("cartelas")
      .select("*")
      .eq("numero_chance1", String(numero_cartela).trim())
      .eq("tipo", "fisica")
      .eq("lote", config.lote_ativo)
      .maybeSingle();

    if (buscaErro) {
      console.error("ERRO BUSCAR CARTELA FISICA:", buscaErro);
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

    const valor = calcularValorCartela(config);

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

    console.error("ERRO GERAR PIX CARTELA FISICA:", erro);

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
app.post("/cartelas/pix-digital", async (req, res) => {
  try {

    const {
      nome,
      cpf,
      telefone,
      vai_na_festa
    } = req.body;

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

    const config = await lerConfigCartelas();

    /* ===== RESERVAR UM NÚMERO DIGITAL (com lock no banco) ===== */
    const { data: cartelaReservada, error: erroReserva } = await supabase
      .rpc("reservar_cartela_digital", { p_lote: config.lote_ativo });

    if (erroReserva) {

      if (String(erroReserva.message || "").includes("NENHUMA_CARTELA_DIGITAL_DISPONIVEL")) {
        return res.status(409).json({
          sucesso: false,
          erro: "Não há cartelas digitais disponíveis no momento."
        });
      }

      console.error("ERRO RESERVAR CARTELA DIGITAL:", erroReserva);

      return res.status(500).json({
        sucesso: false,
        erro: "Erro interno ao reservar cartela digital."
      });
    }

    const valor = calcularValorCartela(config);

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
        valor_pago: valor,
        pix_id: pagamento.txid
      })
      .eq("id", cartelaReservada.id)
      .select()
      .single();

    if (updateErro) {
      console.error("ERRO SALVAR DADOS CARTELA DIGITAL:", updateErro);

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

    console.error("ERRO GERAR PIX CARTELA DIGITAL:", erro);

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

app.post("/cartelas/:id/retomar-pagamento", async (req, res) => {
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
      console.error("ERRO BUSCAR CARTELA RETOMAR PAGAMENTO:", erroBusca);

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

    /* ===== ATUALIZAR APENAS O PIX_ID (sobrescreve o antigo/expirado) ===== */
    const { data: cartelaAtualizada, error: erroUpdate } = await supabase
      .from("cartelas")
      .update({
        pix_id: pagamento.txid
      })
      .eq("id", cartela.id)
      .eq("status", "pendente") // proteção: só atualiza se ainda estiver pendente nesse exato momento
      .select()
      .single();

    if (erroUpdate || !cartelaAtualizada) {
      console.error("ERRO ATUALIZAR PIX_ID RETOMAR PAGAMENTO:", erroUpdate);

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
      qrCode: pagamento.qrCodeBase64
    });

  } catch (erro) {

    console.error("ERRO RETOMAR PAGAMENTO CARTELA:", erro);

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
const CAMINHO_ARTE_BASE = path.join(__dirname, "assets", "arte-cartela-2027-base.png");

/* =====================================================
   Gera a arte da cartela digital (PNG) e sobe pro storage,
   depois atualiza a linha no Supabase com o pdf_url pronto.
   Roda desacoplado da resposta HTTP (ver chamada mais abaixo).
===================================================== */
async function gerarEGuardarCartelaDigital(cartelaAtual, txid) {

  const pngBuffer = await gerarCartelaDigitalPNG(
    {
      numeroChance1: cartelaAtual.numero_chance1,
      numeroChance2: cartelaAtual.numero_chance2,
      gradeChance1: cartelaAtual.grade_chance1,
      gradeChance2: cartelaAtual.grade_chance2,
      nomeComprador: cartelaAtual.nome_comprador,
      cpfComprador: cartelaAtual.cpf_comprador
    },
    CAMINHO_ARTE_BASE
  );

  const pdfUrl = await uploadCartelaDigital(
    supabase,
    cartelaAtual.numero_chance1,
    pngBuffer
  );

  const { error: updateErro } = await supabase
    .from("cartelas")
    .update({
      pdf_url: pdfUrl,
      pdf_gerado_em: new Date().toISOString()
    })
    .eq("pix_id", txid);

  if (updateErro) {
    console.error("ERRO AO SALVAR PDF_URL DA CARTELA DIGITAL:", updateErro);
  }
}

app.get("/cartelas/verificar-pagamento/:txid", async (req, res) => {
  try {

    const { txid } = req.params;
    const pagamento = await consultarPix(txid);

    const statusPagamento = pagamento.status;

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
          console.error("ERRO ATUALIZAR PAGAMENTO CARTELA:", updateErro);
        }

        /* ===== GERAR A CARTELA DIGITAL EM SEGUNDO PLANO =====
           Não usamos "await" aqui de propósito: a resposta pro
           frontend sai na hora avisando que o pagamento foi
           confirmado (pdf_url ainda null), e o próximo polling do
           frontend (a cada 5s) já pega o pdf_url assim que a
           geração/upload da imagem terminar. Isso evita que o
           cliente fique com a tela travada esperando a geração
           da arte pra só então saber que o pagamento passou. */
        if (cartelaAtual.tipo === "digital" && !cartelaAtual.pdf_url) {
          gerarEGuardarCartelaDigital(cartelaAtual, txid).catch((erroGeracao) => {
            console.error("ERRO AO GERAR CARTELA DIGITAL (segundo plano):", erroGeracao);
          });
        }
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
    const { data: cartelaPendente } = await supabase
      .from("cartelas")
      .select("status, reservado_em")
      .eq("pix_id", txid)
      .maybeSingle();

    const expirou =
      !cartelaPendente ||
      (cartelaPendente.status === "pendente" &&
        cartelaPendente.reservado_em &&
        new Date(cartelaPendente.reservado_em).getTime() + 60 * 60 * 1000 < Date.now());

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

    console.error("ERRO VERIFICAR PAGAMENTO CARTELA:", erro);

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
app.get("/admin/cartelas/buscar/:numero", verificarAdminBackend, async (req, res) => {
  try {

    const { numero } = req.params;

    const { data: cartela, error } = await supabase
      .from("cartelas")
      .select("*")
      .or(`numero_chance1.eq.${numero},numero_chance2.eq.${numero}`)
      .maybeSingle();

    if (error) {
      console.error("ERRO BUSCAR CARTELA ADMIN:", error);
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

    console.error("ERRO INTERNO BUSCAR CARTELA ADMIN:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao buscar cartela."
    });
  }
});

/* =====================================================================
   ADMIN — LISTAR TODAS AS CARTELAS
   Cole este bloco no server.js, junto com os outros endpoints de
   cartelas (antes do app.listen). Segue o mesmo padrão de
   /admin/pedidos já existente.
===================================================================== */
app.get("/admin/cartelas", verificarAdminBackend, async (req, res) => {
  try {

    const { data, error } = await supabase
      .from("cartelas")
      .select("*")
      .order("id", { ascending: false });

    if (error) {
      console.error("ERRO LISTAR CARTELAS:", error);
      return res.status(500).json({
        sucesso: false,
        erro: "Erro ao carregar cartelas."
      });
    }

    return res.json({
      sucesso: true,
      total: data.length,
      cartelas: data
    });

  } catch (erro) {

    console.error("ERRO INTERNO LISTAR CARTELAS:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao listar cartelas."
    });
  }
});

/* =====================================================================
   ADMIN — RESUMO/ESTATÍSTICAS DE CARTELAS (cards do topo da página)
===================================================================== */
app.get("/admin/cartelas/resumo", verificarAdminBackend, async (req, res) => {
  try {

    const { data: cartelas, error } = await supabase
      .from("cartelas")
      .select("*");

    if (error) {
      return res.status(500).json({
        sucesso: false,
        erro: "Erro ao carregar resumo de cartelas."
      });
    }

    const pagas = cartelas.filter(c => c.status === "pago");
    const pendentes = cartelas.filter(c => c.status === "pendente");
    const disponiveis = cartelas.filter(c => c.status === "disponivel");

    const fisicasPagas = pagas.filter(c => c.tipo === "fisica");
    const digitaisPagas = pagas.filter(c => c.tipo === "digital");

    const confirmaramPresenca = pagas.filter(c => c.vai_na_festa === "sim");

    const receitaTotal = pagas.reduce(
      (acc, c) => acc + Number(c.valor_pago || 0),
      0
    );

    return res.json({
      sucesso: true,
      total_cartelas: cartelas.length,
      total_pagas: pagas.length,
      total_pendentes: pendentes.length,
      total_disponiveis: disponiveis.length,
      fisicas_pagas: fisicasPagas.length,
      digitais_pagas: digitaisPagas.length,
      confirmaram_presenca: confirmaramPresenca.length,
      receita_total: receitaTotal
    });

  } catch (erro) {

    console.error("ERRO RESUMO CARTELAS:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao gerar resumo de cartelas."
    });
  }
});


app.listen(PORT, () => {
  console.log(`Servidor FPSS PRO rodando na porta ${PORT}`);
});


app.get("/sicredi/teste-pix", async (req, res) => {

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
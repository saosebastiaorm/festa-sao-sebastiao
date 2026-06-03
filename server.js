const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const { MercadoPagoConfig, Payment } = require("mercadopago");
const { createClient } = require("@supabase/supabase-js");

const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});


const app = express();

//const vipRoutes = require("./vip.routes");

/* =====================================================
   CORS MASTER
===================================================== */



"https://festasaosebastiao.com.br",
"https://www.festasaosebastiao.com.br",

app.use(cors({
  origin: function (origin, callback) {
    console.log("ORIGIN RECEBIDA:", origin);

    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origem não permitida pelo CORS"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.options(/.*/, cors());




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
   MERCADO PAGO
===================================================== */
if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
  console.error("ERRO: Token Mercado Pago não encontrado.");
  process.exit(1);
}

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN.trim(),
  options: {
    timeout: 10000
  }
});

const payment = new Payment(client);

/* =====================================================
   FUNÇÕES AUXILIARES
===================================================== */
function limparCPF(cpf) {
  return String(cpf || "").replace(/\D/g, "");
}

function limparTelefone(telefone) {
  return String(telefone || "").replace(/\D/g, "");
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
      preco_churrasco: "/config/preco/churrasco",
      criar_pix: "/criar-pix",
      webhook_mercadopago: "/webhook/mercadopago",
      verificar_pagamento: "/verificar-pagamento/:paymentId",
      consultar_payment_id: "/pedido/:orderId",
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
app.get("/config/preco/churrasco", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("configuracoes")
      .select("valor")
      .eq("chave", "CHU_PRECO")
      .single();

    if (error || !data) {
      return res.status(404).json({
        sucesso: false,
        erro: "Preço não encontrado."
      });
    }

    return res.json({
      sucesso: true,
      valor: Number(data.valor)
    });

  } catch (erro) {
    return res.status(500).json({
      sucesso: false,
      erro: "Erro ao carregar preço."
    });
  }
});

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
      email
    } = req.body;

    if (!nome || !cpf || !quantidade) {
      return res.status(400).json({
        sucesso: false,
        erro: "Nome, CPF e quantidade são obrigatórios."
      });
    }

    const cpfLimpo = limparCPF(cpf);
    const telefoneLimpo = limparTelefone(telefone);

    if (cpfLimpo.length !== 11) {
      return res.status(400).json({
        sucesso: false,
        erro: "CPF inválido."
      });
    }

    const { data: configPreco, error: precoError } = await supabase
      .from("configuracoes")
      .select("valor")
      .eq("chave", "CHU_PRECO")
      .single();

    if (precoError || !configPreco) {
      return res.status(500).json({
        sucesso: false,
        erro: "Preço do produto não configurado."
      });
    }

    const valorUnitario = Number(configPreco.valor);

    if (!valorUnitario || valorUnitario <= 0) {
      return res.status(500).json({
        sucesso: false,
        erro: "Preço inválido na configuração."
      });
    }

    const quantidadeNumerica = Number(quantidade);

    if (!quantidadeNumerica || quantidadeNumerica < 1) {
      return res.status(400).json({
        sucesso: false,
        erro: "Quantidade inválida."
      });
    }

    const total = quantidadeNumerica * valorUnitario;

    /* =====================================================
       GERAR CÓDIGO OFICIAL
    ===================================================== */
    const anoEvento = "2027";
    const produtoTipo = "CHU";

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
   MERCADO PAGO
    ===================================================== */

    const paymentData = {
      body: {
        transaction_amount: total,
        description: `${codigoPedido} - Churrasco FPSS`,
        payment_method_id: "pix",
        payer: {
          email: email || "cliente@fpss.com",
          first_name: nome,
          last_name: sobrenome || "",
          identification: {
            type: "CPF",
            number: cpfLimpo
          }
        }
      }
    };

    const pagamento = await payment.create(paymentData);

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

  payment_id: pagamento.id,

  status_pagamento: "pendente",
  status_retirada: "nao_retirado",

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

  payment_id: pagamento.id,
  codigo_pedido: codigoPedido,
  produto_tipo: produtoTipo,

  total,

  qr_code:
    pagamento.point_of_interaction?.transaction_data?.qr_code || null,

  qr_code_base64:
    pagamento.point_of_interaction?.transaction_data?.qr_code_base64 || null,

  /* NÃO ENVIAR RETIRADA ANTES DO PAGAMENTO */
  pedido: pedidoSalvo || null
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
   WEBHOOK MERCADO PAGO
===================================================== */
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    console.log("Webhook recebido:", req.body);

    const paymentId =
      req.body?.data?.id ||
      req.body?.resource?.split("/")?.pop();

    if (!paymentId) {
      return res.sendStatus(200);
    }
    let novoStatus = "pendente";

    const pagamento = await payment.get({
      id: paymentId
    });

    if (!pagamento || !pagamento.status) {
      return res.sendStatus(200);
    }

  
    if (pagamento.status === "approved") {
      novoStatus = "pago";
    }

    await supabase
      .from("pedidos")
      .update({
        status_pagamento: novoStatus,
        data_pagamento: novoStatus === "pago" ? new Date() : null
      })
      .eq("payment_id", paymentId);

    console.log(
      `Pagamento ${paymentId} atualizado para ${novoStatus}`
    );

    return res.sendStatus(200);

  } catch (erro) {
    console.error("Erro webhook:", erro);
    return res.sendStatus(500);
  }
});

/* =====================================================
   VERIFICAR PAGAMENTO MERCADO PAGO
===================================================== */
app.get("/verificar-pagamento/:paymentId", async (req, res) => {
  try {

    const { paymentId } = req.params;

    const pagamento = await payment.get({ id: paymentId });

    const statusPagamento = pagamento.status;

    /* =========================================
       PAGAMENTO APROVADO
    ========================================= */
    if (statusPagamento === "approved") {

      const { data: pedido, error: pedidoError } = await supabase
        .from("pedidos")
        .select("*")
        .eq("payment_id", paymentId)
        .single();

      if (pedidoError || !pedido) {
        return res.status(404).json({
          sucesso: false,
          erro: "Pedido não encontrado."
        });
      }

      let tokenRetirada = pedido.token_retirada;
      let qrCodeRetirada = pedido.qr_code_retirada;

      /* GERAR RETIRADA SE NÃO EXISTIR */
      if (!tokenRetirada || !qrCodeRetirada) {

        tokenRetirada =
          `RET-${pedido.codigo_pedido}-${Date.now()}`
            .replace(/\s/g, "");

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
          .eq("payment_id", paymentId);

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
          .eq("payment_id", paymentId);
      }

      return res.json({
        sucesso: true,
        payment_id: paymentId,
        status: statusPagamento,
        status_interno: "pago",

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
      .eq("payment_id", paymentId);

    return res.json({
      sucesso: true,
      payment_id: paymentId,
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
   CONSULTAR POR PAYMENT ID
===================================================== */
app.get("/pedido/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const { data, error } = await supabase
      .from("pedidos")
      .select("*")
      .eq("payment_id", orderId)
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
app.get("/admin/dashboard", async (req, res) => {
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
app.get("/admin/pedidos", async (req, res) => {
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

    const codigo = String(req.params.codigo || "").toUpperCase();

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
app.get("/admin/produtos", async (req, res) => {
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
app.post("/admin/produtos", async (req, res) => {
  console.log("BODY RECEBIDO ADMIN PRODUTOS:", req.body);
  try {

    const {
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
	console.log("TIPOS:", {
  codigo,
  nome,
  descricao,
  preco,
  ativo,
  estoque,
  tipo,
  imagem,
  ordem
});
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

    /* =========================================
       BUSCA PRODUTO EXISTENTE
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



    let resultado;

    /* =========================================
       UPDATE
    ========================================= */
    if (produtoExistente) {

      resultado = await supabase
        .from("produtos")
        .update(produtoData)
        .eq("codigo", codigoNormalizado)
        .select();

    } else {

      /* =========================================
         INSERT
      ========================================= */
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

console.log("RESULTADO SUPABASE:", resultado);

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
   ADMIN UPLOAD IMAGEM PRODUTO
===================================================== */
app.post("/admin/upload-imagem", upload.single("imagem"), async (req, res) => {
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

    const extensao =
      req.file.originalname.split(".").pop().toLowerCase();

    const caminhoArquivo = `${nomeArquivo}.${extensao}`;

    const { error: uploadError } = await supabase.storage
      .from("produtos")
      .upload(caminhoArquivo, req.file.buffer, {
        contentType: req.file.mimetype,
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
      arquivo: caminhoArquivo
    });

  } catch (erro) {

    console.error("ERRO INTERNO UPLOAD:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: erro.message || "Erro interno upload."
    });
  }
});
 


app.get("/retirada/teste/:codigoPedido", async (req, res) => {
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

    if (cpfLimpo.length !== 11) {
      return res.status(400).json({
        sucesso: false,
        erro: "CPF inválido."
      });
    }

    const { data, error } = await supabase
      .from("pedidos")
      .select("*")
      .eq("cpf", cpfLimpo)
      .order("id", { ascending: false });

    if (error || !data || data.length === 0) {
      return res.status(404).json({
        sucesso: false,
        erro: "Cliente não encontrado."
      });
    }

    return res.json({
      sucesso: true,
      cliente: {
        nome: `${data[0].nome || ""} ${data[0].sobrenome || ""}`.trim(),
        cpf: data[0].cpf,
        telefone: data[0].telefone,
        total_pedidos: data.length,
        pedidos: data
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


app.listen(PORT, () => {
  console.log(`Servidor FPSS PRO rodando na porta ${PORT}`);
});

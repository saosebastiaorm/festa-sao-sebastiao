const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { MercadoPagoConfig, Payment } = require("mercadopago");
const { createClient } = require("@supabase/supabase-js");

const app = express();

/* =====================================================
   CORS MASTER
===================================================== */
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.LOCAL_URL,
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://localhost:3000",
  "https://festa-sao-sebastiao.vercel.app"
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback){

    if(!origin){
      return callback(null, true);
    }

    if(allowedOrigins.includes(origin)){
      return callback(null, true);
    }

    return callback(null, true);
  },

  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.options(/.*/, cors());

app.use(express.json({ limit: "10mb" }));

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
   CRIAR PIX + SALVAR PEDIDO
===================================================== */
app.post("/criar-pix", async (req, res) => {

  try {

    const {
      nome,
      sobrenome,
      cpf,
      telefone,
      quantidade,
      horario_retirada
    } = req.body;

    /* =========================
       VALIDAÇÕES
    ========================= */
    if (!nome || !sobrenome || !cpf || !telefone || !quantidade) {
      return res.status(400).json({
        sucesso: false,
        erro: "Dados obrigatórios ausentes."
      });
    }

    const cpfLimpo = String(cpf).replace(/\D/g, "");

    if (cpfLimpo.length !== 11) {
      return res.status(400).json({
        sucesso: false,
        erro: "CPF inválido."
      });
    }

    const qtd = Number(quantidade);

    if (!qtd || qtd <= 0) {
      return res.status(400).json({
        sucesso: false,
        erro: "Quantidade inválida."
      });
    }

    /* =========================
       VALORES
    ========================= */
    const valorUnitario = 60;
    const total = Number((qtd * valorUnitario).toFixed(2));

    /* =========================
       PAGAMENTO PIX
    ========================= */
    const pagamentoCriado = await payment.create({
      body: {
        transaction_amount: total,
        description: `Churrasco FPSS - ${nome} ${sobrenome}`,
        payment_method_id: "pix",

        payer: {
          email: `cliente.fpss.${Date.now()}@gmail.com`,
          first_name: nome,
          last_name: sobrenome,
          identification: {
            type: "CPF",
            number: cpfLimpo
          }
        },

        metadata: {
          projeto: "FPSS",
          telefone: telefone || "",
          quantidade: qtd,
          horario_retirada: horario_retirada || "Não informado"
        }
      },

      requestOptions: {
        idempotencyKey: `fpss-${Date.now()}-${cpfLimpo}`
      }
    });

    /* =========================
       VALIDAÇÃO RESPOSTA MP
    ========================= */
    if (
      !pagamentoCriado ||
      !pagamentoCriado.id
    ) {
      return res.status(500).json({
        sucesso: false,
        erro: "Mercado Pago não retornou pagamento válido."
      });
    }

    const qrCode =
      pagamentoCriado.point_of_interaction?.transaction_data?.qr_code || null;

    const qrCodeBase64 =
      pagamentoCriado.point_of_interaction?.transaction_data?.qr_code_base64 || null;

    /* =========================
       SALVAR PEDIDO
    ========================= */
    const { data: pedidoSalvo, error: erroPedido } = await supabase
      .from("pedidos")
      .insert([
        {
          order_id: String(pagamentoCriado.id),
          nome,
          sobrenome,
          cpf: cpfLimpo,
          telefone,
          valor_total: total,
          valor_unitario: valorUnitario,
          quantidade: qtd,
          horario_retirada: horario_retirada || null,
          status: pagamentoCriado.status
            ? String(pagamentoCriado.status).toUpperCase()
            : "PENDING",
          txid: String(pagamentoCriado.id),
          pix_copia_cola: qrCode,
          qr_code: qrCodeBase64
        }
      ])
      .select()
      .single();

    if (erroPedido) {
      console.error("ERRO SUPABASE PEDIDO:", erroPedido);

      return res.status(500).json({
        sucesso: false,
        erro: "Erro ao salvar pedido no banco."
      });
    }

    /* =========================
       ITEM PEDIDO
    ========================= */
    const { error: erroItem } = await supabase
      .from("itens_pedido")
      .insert([
        {
          pedido_id: pedidoSalvo.id,
          produto_nome: "Churrasco",
          categoria: "CHURRASCO",
          quantidade: qtd,
          valor_unitario: valorUnitario,
          valor_total_item: total,
          horario_retirada: horario_retirada || null
        }
      ]);

    if (erroItem) {
      console.error("ERRO SUPABASE ITEM:", erroItem);
    }

    /* =========================
       RESPOSTA FRONTEND
    ========================= */
    return res.status(200).json({
      sucesso: true,
      payment_id: pagamentoCriado.id,
      status: pagamentoCriado.status || "pending",
      total,
      qr_code: qrCode,
      qr_code_base64: qrCodeBase64
    });

  } catch (error) {

    console.error("ERRO CRIAR PIX:");
    console.error(JSON.stringify(error, null, 2));

    return res.status(500).json({
      sucesso: false,
      erro: error.message || "Erro interno no servidor.",
      detalhes: error.cause || null
    });

  }

});

/* =====================================================
   WEBHOOK MERCADO PAGO
===================================================== */
app.post("/webhook/mercadopago", async (req, res) => {

  try {

    console.log("WEBHOOK:", JSON.stringify(req.body, null, 2));

    const paymentId =
      req.body?.data?.id ||
      req.body?.resource?.split("/")?.pop();

    if (!paymentId) {
      return res.status(200).send("Webhook sem payment ID.");
    }

    const pagamento = await payment.get({
      id: paymentId
    });

    const novoStatus = pagamento?.status
      ? String(pagamento.status).toUpperCase()
      : "PENDING";

    const { error } = await supabase
      .from("pedidos")
      .update({
        status: novoStatus,
        updated_at: new Date().toISOString()
      })
      .eq("order_id", String(paymentId));

    if (error) {
      console.error("ERRO UPDATE:", error);
    }

    return res.status(200).send("OK");

  } catch (error) {

    console.error("ERRO WEBHOOK:", error);

    return res.status(500).send("Erro webhook.");

  }

});

/* =====================================================
   CONSULTAR PEDIDO
===================================================== */
app.get("/pedido/:orderId", async (req, res) => {

  try {

    const { orderId } = req.params;

    const { data, error } = await supabase
      .from("pedidos")
      .select("*")
      .eq("order_id", orderId)
      .single();

    if (error || !data) {
      return res.status(404).json({
        sucesso: false,
        erro: "Pedido não encontrado."
      });
    }

    return res.status(200).json({
      sucesso: true,
      pedido: data
    });

  } catch (error) {

    return res.status(500).json({
      sucesso: false,
      erro: "Erro ao consultar pedido."
    });

  }

});

/* =====================================================
   SERVIDOR
===================================================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor FPSS PRO rodando na porta ${PORT}`);
});
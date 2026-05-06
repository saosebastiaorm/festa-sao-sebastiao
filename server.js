const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { MercadoPagoConfig, Payment } = require("mercadopago");
const { createClient } = require("@supabase/supabase-js");

const app = express();

/* =====================================================
   CORS
===================================================== */
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    process.env.LOCAL_URL
  ],
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(express.json());

/* =====================================================
   SUPABASE
===================================================== */
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
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
  options: {
    timeout: 5000
  }
});

const payment = new Payment(client);

/* =====================================================
   STATUS
===================================================== */
app.get("/", (req, res) => {
  res.json({
    status: "online",
    sistema: "FPSS Mercado Pago + Supabase + Webhook",
    ambiente: process.env.NODE_ENV
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

    const cpfLimpo = cpf.replace(/\D/g, "");

    if (cpfLimpo.length !== 11) {
      return res.status(400).json({
        sucesso: false,
        erro: "CPF inválido."
      });
    }

    const qtd = Number(quantidade);

    if (isNaN(qtd) || qtd <= 0) {
      return res.status(400).json({
        sucesso: false,
        erro: "Quantidade inválida."
      });
    }

    /* =========================
       VALORES
    ========================= */
    const valorUnitario = 60;
    const total = qtd * valorUnitario;

    /* =========================
       CRIAR PAGAMENTO PIX
    ========================= */
    const result = await payment.create({
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
          telefone,
          quantidade: qtd,
          horario_retirada: horario_retirada || "Não informado"
        }
      },

      requestOptions: {
        idempotencyKey: `fpss-${Date.now()}-${cpfLimpo}`
      }
    });

    /* =========================
       SALVAR PEDIDO
    ========================= */
    const { data: pedidoSalvo, error: erroPedido } = await supabase
      .from("pedidos")
      .insert([
        {
          order_id: String(result.id),
          nome,
          sobrenome,
          cpf: cpfLimpo,
          telefone,
          valor_total: total,
          valor_unitario: valorUnitario,
          quantidade: qtd,
          horario_retirada,
          status: result.status ? result.status.toUpperCase() : "PENDENTE",
          txid: String(result.id),
          pix_copia_cola: result.point_of_interaction?.transaction_data?.qr_code || null,
          qr_code: result.point_of_interaction?.transaction_data?.qr_code_base64 || null
        }
      ])
      .select()
      .single();

    if (erroPedido) {
      console.error("ERRO SUPABASE PEDIDO:", erroPedido);
    } else {

      /* =========================
         SALVAR ITEM PEDIDO
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
            horario_retirada
          }
        ]);

      if (erroItem) {
        console.error("ERRO SUPABASE ITEM:", erroItem);
      }

    }

    /* =========================
       RESPOSTA
    ========================= */
    return res.status(200).json({
      sucesso: true,
      payment_id: result.id,
      status: result.status,
      total,
      qr_code: result.point_of_interaction?.transaction_data?.qr_code || null,
      qr_code_base64: result.point_of_interaction?.transaction_data?.qr_code_base64 || null
    });

  } catch (error) {

    console.error("ERRO MERCADO PAGO:", JSON.stringify(error, null, 2));

    return res.status(500).json({
      sucesso: false,
      erro: error.message || "Erro interno no pagamento.",
      detalhes: error.cause || null
    });

  }
});

/* =====================================================
   WEBHOOK MERCADO PAGO
===================================================== */
app.post("/webhook/mercadopago", async (req, res) => {
  try {

    console.log("WEBHOOK RECEBIDO:", JSON.stringify(req.body, null, 2));

    const paymentId =
      req.body?.data?.id ||
      req.body?.resource?.split("/")?.pop();

    if (!paymentId) {
      return res.status(200).send("Webhook recebido sem payment ID.");
    }

    /* =========================
       CONSULTAR PAGAMENTO REAL
    ========================= */
    const pagamento = await payment.get({
      id: paymentId
    });

    const novoStatus = pagamento.status
      ? pagamento.status.toUpperCase()
      : "PENDENTE";

    /* =========================
       ATUALIZAR PEDIDO
    ========================= */
    const { error: erroUpdate } = await supabase
      .from("pedidos")
      .update({
        status: novoStatus,
        updated_at: new Date().toISOString()
      })
      .eq("order_id", String(paymentId));

    if (erroUpdate) {
      console.error("ERRO UPDATE STATUS:", erroUpdate);
    } else {
      console.log(`Pedido ${paymentId} atualizado para ${novoStatus}`);
    }

    return res.status(200).send("Webhook processado com sucesso.");

  } catch (error) {

    console.error("ERRO WEBHOOK:", error);

    return res.status(500).send("Erro no webhook.");

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
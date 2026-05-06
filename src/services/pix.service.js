/* =====================================================
   ARQUIVO: src/services/pix.service.js
   ETAPA 6.5 — SUPABASE + SICREDI PIX
===================================================== */

const supabase = require("../config/supabase");
const { validarCPF, validarTelefone } = require("../utils/validators");
const { criarCobrancaPix } = require("./sicredi.service");

async function criarPedidoPix(dados) {
    const {
        nome,
        sobrenome,
        cpf,
        telefone,
        quantidade,
        horario_retirada
    } = dados;

    /* =====================================================
       VALIDAÇÕES
    ===================================================== */
    if (!nome || !sobrenome) {
        throw new Error("Nome e sobrenome são obrigatórios");
    }

    if (!validarCPF(cpf)) {
        throw new Error("CPF inválido");
    }

    if (!validarTelefone(telefone)) {
        throw new Error("Telefone inválido");
    }

    if (!quantidade || quantidade < 1) {
        throw new Error("Quantidade inválida");
    }

    /* =====================================================
       CÁLCULOS
    ===================================================== */
    const valor_unitario = 60;
    const valor_total = quantidade * valor_unitario;

    const orderId = `FPSS-${Date.now()}`;

    /* =====================================================
       SICREDI PIX
    ===================================================== */
    const pixResult = await criarCobrancaPix({
        orderId,
        nome: `${nome} ${sobrenome}`,
        valor: valor_total
    });

    if (!pixResult.success) {
        throw new Error(
            `Erro ao gerar cobrança Sicredi: ${JSON.stringify(pixResult.error)}`
        );
    }

    /* =====================================================
       SALVAR PEDIDO
    ===================================================== */
    const { data: pedido, error: pedidoError } = await supabase
        .from("pedidos")
        .insert([
            {
                order_id: orderId,
                nome,
                sobrenome,
                cpf,
                telefone,
                quantidade,
                valor_unitario,
                valor_total,
                horario_retirada,
                status: "PENDENTE",
                txid: pixResult.txid,
                pix_copia_cola: pixResult.pixCopiaECola,
                qr_code: pixResult.qrCode
            }
        ])
        .select()
        .single();

    if (pedidoError) {
        throw new Error(`Erro ao salvar pedido: ${pedidoError.message}`);
    }

    /* =====================================================
       RETORNO
    ===================================================== */
    return {
        success: true,
        message: "Pedido e Pix gerados com sucesso",
        data: {
            id: pedido.id,
            orderId,
            nome,
            sobrenome,
            cpf,
            telefone,
            quantidade,
            valor_unitario,
            valor_total,
            horario_retirada,
            status: pedido.status,
            txid: pixResult.txid,
            pixCopiaECola: pixResult.pixCopiaECola,
            qrCode: pixResult.qrCode,
            createdAt: pedido.created_at
        },
        error: null
    };
}

module.exports = {
    criarPedidoPix
};
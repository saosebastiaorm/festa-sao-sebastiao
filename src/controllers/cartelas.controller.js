/* =====================================================
   ARQUIVO: src/controllers/cartelas.controller.js
===================================================== */

const cartelasService = require("../services/cartelas.service");

/* POST /cartelas/validar-numero
   Usado pelo formulário de cartela física para checar,
   em tempo real, se o número digitado existe e está disponível. */
async function validarNumero(req, res) {
    try {
        const { numero } = req.body;

        if (!numero) {
            return res.status(400).json({ sucesso: false, erro: "Informe o número da cartela." });
        }

        const resultado = await cartelasService.validarNumeroCartelaFisica(numero);

        if (!resultado.valido) {
            const mensagens = {
                NAO_ENCONTRADA: "Essa cartela não existe. Verifique o número e tente novamente.",
                JA_PAGA: "Essa cartela já foi paga anteriormente.",
                CANCELADA: "Essa cartela foi cancelada e não pode ser paga."
            };
            return res.status(404).json({
                sucesso: false,
                valido: false,
                erro: mensagens[resultado.motivo] || "Cartela inválida."
            });
        }

        return res.json({ sucesso: true, valido: true });

    } catch (erro) {
        console.error("ERRO VALIDAR NUMERO CARTELA:", erro.message);
        return res.status(500).json({ sucesso: false, erro: "Erro interno ao validar a cartela." });
    }
}

/* POST /cartelas/pix-fisica */
async function criarPixFisica(req, res) {
    try {
        const resultado = await cartelasService.criarPedidoCartelaFisica(req.body);
        return res.json({ sucesso: true, ...resultado.data });

    } catch (erro) {
        console.error("ERRO CRIAR PIX CARTELA FISICA:", erro.message);
        return res.status(400).json({ sucesso: false, erro: erro.message });
    }
}

/* POST /cartelas/pix-digital */
async function criarPixDigital(req, res) {
    try {
        const resultado = await cartelasService.criarPedidoCartelaDigital(req.body);
        return res.json({ sucesso: true, ...resultado.data });

    } catch (erro) {
        console.error("ERRO CRIAR PIX CARTELA DIGITAL:", erro.message);
        return res.status(400).json({ sucesso: false, erro: erro.message });
    }
}

/* GET /cartelas/verificar-pagamento/:txid
   A tela de pagamento consulta este endpoint periodicamente
   (mesmo modelo de polling usado na compra de produtos). */
async function statusPagamento(req, res) {
    try {
        const { txid } = req.params;
        const resultado = await cartelasService.confirmarPagamentoCartela(txid);

        if (!resultado.pago) {
            return res.json({
                sucesso: true,
                status_interno: resultado.status === "ATIVA" ? "pendente" : resultado.status,
                cartela: null
            });
        }

        return res.json({
            sucesso: true,
            status_interno: "pago",
            data_pagamento: resultado.cartela.data_pagamento,
            cartela: {
                numero_cartela: resultado.cartela.numero_chance1,
                numero_chance2: resultado.cartela.numero_chance2,
                tipo: resultado.cartela.tipo,
                nome: resultado.cartela.nome_comprador,
                cpf: resultado.cartela.cpf_comprador,
                telefone: resultado.cartela.whatsapp_comprador,
                valor: resultado.cartela.valor_pago,
                comprovante_id: resultado.cartela.comprovante_id
            }
        });

    } catch (erro) {
        console.error("ERRO STATUS PAGAMENTO CARTELA:", erro.message);
        return res.status(500).json({ sucesso: false, erro: "Erro ao consultar status do pagamento." });
    }
}

/* GET /admin/cartelas/buscar/:numero
   Usado na conferência do sorteio. */
async function buscarPorNumero(req, res) {
    try {
        const { numero } = req.params;
        const cartela = await cartelasService.buscarCartelaPorNumero(numero);

        if (!cartela) {
            return res.status(404).json({ sucesso: false, erro: "Cartela não encontrada." });
        }

        return res.json({ sucesso: true, cartela });

    } catch (erro) {
        console.error("ERRO BUSCAR CARTELA ADMIN:", erro.message);
        return res.status(500).json({ sucesso: false, erro: "Erro ao buscar cartela." });
    }
}

module.exports = {
    validarNumero,
    criarPixFisica,
    criarPixDigital,
    statusPagamento,
    buscarPorNumero
};

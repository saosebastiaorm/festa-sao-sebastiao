/* =====================================================
   ARQUIVO: src/services/cartelas.service.js
   Sistema de Cartelas — FPSS 2027 (físicas + digitais)
===================================================== */

const supabase = require("../config/supabase");
const { validarCPF, validarTelefone } = require("../utils/validators");
const { criarCobrancaPix } = require("./sicredi.service");

/* =====================================================
   CONFIG — lê o lote ativo e o modo (teste/oficial)
   direto da tabela cartelas_config
===================================================== */
async function lerConfig() {
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

function calcularValorCobranca(config) {
    const emModoTeste = config.modo_teste === "true";
    const centavos = emModoTeste
        ? Number(config.valor_teste_centavos || 1)
        : Number(config.valor_cartela_oficial_centavos || 2000);

    return centavos / 100;
}

/* =====================================================
   FLUXO 1 — CARTELA FÍSICA
   A pessoa já tem a cartela em mãos e informa o número
   impresso no canhoto (numero_chance1).
===================================================== */
async function validarNumeroCartelaFisica(numeroChance1) {
    const config = await lerConfig();

    const { data: cartela, error } = await supabase
        .from("cartelas")
        .select("*")
        .eq("numero_chance1", String(numeroChance1).trim())
        .eq("tipo", "fisica")
        .eq("lote", config.lote_ativo)
        .maybeSingle();

    if (error) {
        throw new Error(`Erro ao consultar cartela: ${error.message}`);
    }

    if (!cartela) {
        return { valido: false, motivo: "NAO_ENCONTRADA" };
    }

    if (cartela.status === "pago") {
        return { valido: false, motivo: "JA_PAGA", cartela };
    }

    if (cartela.status === "cancelado") {
        return { valido: false, motivo: "CANCELADA", cartela };
    }

    return { valido: true, cartela };
}

async function criarPedidoCartelaFisica(dados) {
    const {
        numero_cartela,
        nome,
        cpf,
        telefone,
        vai_na_festa
    } = dados;

    /* ===== VALIDAÇÕES ===== */
    if (!numero_cartela) {
        throw new Error("Número da cartela é obrigatório");
    }

    if (!nome) {
        throw new Error("Nome é obrigatório");
    }

    if (!validarCPF(cpf)) {
        throw new Error("CPF inválido");
    }

    if (!validarTelefone(telefone)) {
        throw new Error("Telefone inválido");
    }

    if (!["sim", "nao"].includes(vai_na_festa)) {
        throw new Error("Informe se vai participar da festa (sim/nao)");
    }

    const config = await lerConfig();

    const checagem = await validarNumeroCartelaFisica(numero_cartela);

    if (!checagem.valido) {
        const mensagens = {
            NAO_ENCONTRADA: "Essa cartela não existe. Verifique o número e tente novamente.",
            JA_PAGA: "Essa cartela já foi paga anteriormente.",
            CANCELADA: "Essa cartela foi cancelada e não pode ser paga."
        };
        throw new Error(mensagens[checagem.motivo] || "Cartela inválida.");
    }

    const cartela = checagem.cartela;
    const valor = calcularValorCobranca(config);
    const orderId = `FPSS-CARTELA-${Date.now()}`;

    /* ===== SICREDI PIX ===== */
    const pixResult = await criarCobrancaPix({
        orderId,
        nome,
        valor
    });

    if (!pixResult.success) {
        throw new Error(`Erro ao gerar cobrança Sicredi: ${JSON.stringify(pixResult.error)}`);
    }

    /* ===== ATUALIZAR CARTELA NO BANCO ===== */
    const { data: cartelaAtualizada, error: erroUpdate } = await supabase
        .from("cartelas")
        .update({
            status: "pendente",
            nome_comprador: nome,
            cpf_comprador: cpf,
            whatsapp_comprador: telefone,
            vai_na_festa,
            valor_pago: valor,
            pix_id: pixResult.txid
        })
        .eq("id", cartela.id)
        .eq("status", "disponivel") // proteção extra contra corrida (duas pessoas pagando a mesma cartela ao mesmo tempo)
        .select()
        .single();

    if (erroUpdate || !cartelaAtualizada) {
        throw new Error("Essa cartela acabou de ser reservada por outra pessoa. Tente novamente com outro número.");
    }

    return montarRespostaPix(cartelaAtualizada, pixResult);
}

/* =====================================================
   FLUXO 2 — CARTELA DIGITAL
   O sistema atribui automaticamente o próximo número
   digital disponível, via função SQL reservar_cartela_digital
   (usa lock no banco para não duplicar em concorrência).
===================================================== */
async function criarPedidoCartelaDigital(dados) {
    const {
        nome,
        cpf,
        telefone,
        vai_na_festa
    } = dados;

    /* ===== VALIDAÇÕES ===== */
    if (!nome) {
        throw new Error("Nome é obrigatório");
    }

    if (!validarCPF(cpf)) {
        throw new Error("CPF inválido");
    }

    if (!validarTelefone(telefone)) {
        throw new Error("Telefone inválido");
    }

    if (!["sim", "nao"].includes(vai_na_festa)) {
        throw new Error("Informe se vai participar da festa (sim/nao)");
    }

    const config = await lerConfig();

    /* ===== RESERVAR UM NÚMERO DIGITAL (via função SQL com lock) ===== */
    const { data: cartelaReservada, error: erroReserva } = await supabase
        .rpc("reservar_cartela_digital", { p_lote: config.lote_ativo });

    if (erroReserva) {
        if (String(erroReserva.message).includes("NENHUMA_CARTELA_DIGITAL_DISPONIVEL")) {
            throw new Error("Não há cartelas digitais disponíveis no momento.");
        }
        throw new Error(`Erro ao reservar cartela digital: ${erroReserva.message}`);
    }

    const valor = calcularValorCobranca(config);
    const orderId = `FPSS-CARTELA-${Date.now()}`;

    /* ===== SICREDI PIX ===== */
    const pixResult = await criarCobrancaPix({
        orderId,
        nome,
        valor
    });

    if (!pixResult.success) {
        // libera a cartela de volta pra disponível, já que o Pix falhou
        await supabase
            .from("cartelas")
            .update({ status: "disponivel" })
            .eq("id", cartelaReservada.id);

        throw new Error(`Erro ao gerar cobrança Sicredi: ${JSON.stringify(pixResult.error)}`);
    }

    /* ===== ATUALIZAR CARTELA COM DADOS DO COMPRADOR ===== */
    const { data: cartelaAtualizada, error: erroUpdate } = await supabase
        .from("cartelas")
        .update({
            nome_comprador: nome,
            cpf_comprador: cpf,
            whatsapp_comprador: telefone,
            vai_na_festa,
            valor_pago: valor,
            pix_id: pixResult.txid
        })
        .eq("id", cartelaReservada.id)
        .select()
        .single();

    if (erroUpdate) {
        throw new Error(`Erro ao salvar dados do comprador: ${erroUpdate.message}`);
    }

    return montarRespostaPix(cartelaAtualizada, pixResult);
}

/* =====================================================
   RESPOSTA PADRÃO (igual ao formato usado em pix.service.js)
===================================================== */
function montarRespostaPix(cartela, pixResult) {
    return {
        success: true,
        message: "Cartela reservada e Pix gerado com sucesso",
        data: {
            id: cartela.id,
            numero_cartela: cartela.numero_chance1,
            numero_chance2: cartela.numero_chance2,
            tipo: cartela.tipo,
            nome: cartela.nome_comprador,
            cpf: cartela.cpf_comprador,
            telefone: cartela.whatsapp_comprador,
            vai_na_festa: cartela.vai_na_festa,
            valor: cartela.valor_pago,
            status: cartela.status,
            txid: pixResult.txid,
            pixCopiaECola: pixResult.pixCopiaECola,
            qrCode: pixResult.qrCode,
            createdAt: cartela.criado_em
        },
        error: null
    };
}

/* =====================================================
   CONFIRMAR PAGAMENTO (consulta status no Sicredi e
   atualiza a cartela — mesmo modelo usado em pedidos)
===================================================== */
async function confirmarPagamentoCartela(txid) {
    const { consultarPix } = require("./consultarPix");

    const resultado = await consultarPix(txid);

    const pago = resultado?.status === "CONCLUIDA";

    if (!pago) {
        return { pago: false, status: resultado?.status || "DESCONHECIDO" };
    }

    const { data: cartela, error } = await supabase
        .from("cartelas")
        .update({
            status: "pago",
            data_pagamento: new Date().toISOString(),
            comprovante_id: `COMP-${txid}`
        })
        .eq("pix_id", txid)
        .select()
        .single();

    if (error) {
        throw new Error(`Erro ao confirmar pagamento da cartela: ${error.message}`);
    }

    return { pago: true, cartela };
}

/* =====================================================
   ADMIN — buscar cartela por número (conferência do sorteio)
===================================================== */
async function buscarCartelaPorNumero(numero) {
    const { data, error } = await supabase
        .from("cartelas")
        .select("*")
        .or(`numero_chance1.eq.${numero},numero_chance2.eq.${numero}`)
        .maybeSingle();

    if (error) {
        throw new Error(`Erro ao buscar cartela: ${error.message}`);
    }

    return data;
}

module.exports = {
    validarNumeroCartelaFisica,
    criarPedidoCartelaFisica,
    criarPedidoCartelaDigital,
    confirmarPagamentoCartela,
    buscarCartelaPorNumero,
    lerConfig
};

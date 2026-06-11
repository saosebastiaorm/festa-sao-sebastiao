const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const { getAccessToken, agent } = require("./auth");

async function criarPix(valor, nome, cpf) {

    console.log("======================================");
    console.log("INICIANDO CRIAÇÃO DO PIX SICREDI");
    console.log("Valor:", valor);
    console.log("Nome :", nome);
    console.log("CPF  :", cpf);
    console.log("======================================");

    const token = await getAccessToken();

    const txid = uuidv4()
        .replace(/-/g, "")
        .substring(0, 26);

    const response = await axios.put(

        `${process.env.SICREDI_BASE_URL}/api/v2/cob/${txid}`,

        {

            calendario: {
                expiracao: 3600
            },

            valor: {
                original: Number(valor).toFixed(2)
            },

            chave: process.env.SICREDI_PIX_KEY,

            solicitacaoPagador: "Pagamento FPSS 2027",

            devedor: {
                cpf,
                nome
            }

        },

        {

            headers: {
                Authorization: `Bearer ${token}`
            },

            httpsAgent: agent

        }

    );

    console.log(
        "RETORNO COBRANÇA SICREDI:"
    );

    console.log(
        JSON.stringify(response.data, null, 2)
    );

    if (
        !response.data.loc ||
        !response.data.loc.location
    ) {

        console.error(
            "ERRO: loc.location não retornado pelo Sicredi."
        );

        return {
            txid: response.data.txid
        };

    }

 // ======================================
// O Sicredi já retorna o PIX Copia e Cola
// diretamente na criação da cobrança.
// Não é necessário consultar o endpoint
// loc.location para obter o QR.
// ======================================

return {

    txid: response.data.txid,

    // Código PIX Copia e Cola
    pixCopiaECola:
        response.data.pixCopiaECola || null,

    // Vamos deixar nulo e gerar o QR Code
    // diretamente no frontend utilizando
    // a biblioteca QRCode.js.
    qrCodeBase64: null

};

}

module.exports = {
    criarPix
};
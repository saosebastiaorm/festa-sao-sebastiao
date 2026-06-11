const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const { getAccessToken, agent } = require("./auth");

async function criarPix(valor, nome, cpf) {
    console.log("VALOR RECEBIDO NO criarPix:", valor);
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
    "RETORNO SICREDI:",
    JSON.stringify(response.data, null, 2)
);

// Obtém o QR Code dinâmico do endpoint loc
const qrResponse = await axios.get(
    response.data.loc.location,
    {
        headers: {
            Authorization: `Bearer ${token}`
        },
        httpsAgent: agent
    }
);

return {
    txid: response.data.txid,

    pixCopiaECola:
        qrResponse.data.qrcode,

    qrCodeBase64:
        qrResponse.data.imagemQrcode
};
}

module.exports = {
    criarPix
};
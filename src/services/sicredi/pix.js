const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const { getAccessToken, agent } = require("./auth");

async function criarPix(valor, nome, cidade) {

    const token = await getAccessToken();

    const txid = uuidv4().replace(/-/g, "").substring(0, 26);

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
                nome,
                cidade
            }
        },
        {
            headers: {
                Authorization: `Bearer ${token}`
            },
            httpsAgent: agent
        }
    );

    return response.data;
}

module.exports = {
    criarPix
};
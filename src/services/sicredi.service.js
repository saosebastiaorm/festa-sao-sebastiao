/* =====================================================
   ARQUIVO: src/services/sicredi.service.js
   ETAPA 6.3 — SICREDI PIX HOMOLOGAÇÃO
===================================================== */

const axios = require("axios");
const https = require("https");
const fs = require("fs");
const path = require("path");

const {
    SICREDI_BASE_URL,
    CLIENT_ID,
    CLIENT_SECRET,
    SICREDI_PIX_KEY,
    CERT_PATH,
    KEY_PATH,
    SICREDI_SANDBOX
} = process.env;

/* =====================================================
   HTTPS AGENT
   Sandbox inicialmente sem certificado obrigatório
   Produção depois com mTLS
===================================================== */

function getHttpsAgent() {
    const certFile = path.resolve(CERT_PATH || "");
    const keyFile = path.resolve(KEY_PATH || "");

    if (
        SICREDI_SANDBOX === "true" &&
        (!fs.existsSync(certFile) || !fs.existsSync(keyFile))
    ) {
        return new https.Agent({
            rejectUnauthorized: false
        });
    }

    return new https.Agent({
        cert: fs.readFileSync(certFile),
        key: fs.readFileSync(keyFile),
        rejectUnauthorized: false
    });
}

/* =====================================================
   TOKEN OAUTH SICREDI
===================================================== */

async function gerarTokenSicredi() {
    try {
        const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

        const response = await axios.post(
            `${SICREDI_BASE_URL}/oauth/token`,
            "grant_type=client_credentials&scope=cob.write cob.read pix.write pix.read",
            {
                headers: {
                    Authorization: `Basic ${auth}`,
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                httpsAgent: getHttpsAgent()
            }
        );

        return response.data.access_token;

    } catch (error) {
        console.error("ERRO TOKEN SICREDI:", error.response?.data || error.message);
        throw new Error("Falha ao gerar token Sicredi");
    }
}

/* =====================================================
   CRIAR COBRANÇA PIX
===================================================== */

async function criarCobrancaPix({ orderId, nome, valor }) {
    try {
        const token = await gerarTokenSicredi();

        const txid = orderId.replace(/[^a-zA-Z0-9]/g, "").substring(0, 26);

        const payload = {
            calendario: {
                expiracao: 3600
            },
            devedor: {
                nome: nome,
                cpf: SICREDI_PIX_KEY
            },
            valor: {
                original: Number(valor).toFixed(2)
            },
            chave: SICREDI_PIX_KEY,
            solicitacaoPagador: `Pedido ${orderId} - Festa Padroeiro São Sebastião`
        };

        const response = await axios.put(
            `${SICREDI_BASE_URL}/api/v2/cob/${txid}`,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                httpsAgent: getHttpsAgent()
            }
        );

        return {
            success: true,
            txid,
            location: response.data.location,
            pixCopiaECola: response.data.pixCopiaECola || null,
            qrCode: response.data.imagemQrcode || null,
            raw: response.data
        };

    } catch (error) {
        console.error("ERRO COBRANÇA SICREDI:", error.response?.data || error.message);

        return {
            success: false,
            error: error.response?.data || error.message
        };
    }
}

module.exports = {
    gerarTokenSicredi,
    criarCobrancaPix
};
const axios = require("axios");
const https = require("https");
const fs = require("fs");

console.log("CERT:", process.env.SICREDI_CERT_PATH);
console.log("KEY :", process.env.SICREDI_KEY_PATH);
console.log("CA  :", process.env.SICREDI_CHAIN_PATH);

const cert = fs.readFileSync(process.env.SICREDI_CERT_PATH);

const key = fs.readFileSync(process.env.SICREDI_KEY_PATH);

const ca = fs.readFileSync(process.env.SICREDI_CHAIN_PATH);

const agent = new https.Agent({
    cert,
    key,
    rejectUnauthorized: false
});

async function getAccessToken() {

    const auth = Buffer.from(
        `${process.env.SICREDI_CLIENT_ID}:${process.env.SICREDI_CLIENT_SECRET}`
    ).toString("base64");

try {

    const response = await axios.post(
        `${process.env.SICREDI_BASE_URL}/oauth/token`,
        "grant_type=client_credentials",
        {
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            httpsAgent: agent
        }
    );

    return response.data.access_token;

} catch (err) {

    console.log("========== ERRO COMPLETO ==========");

    console.log(err.code);

    console.log(err.message);

    console.log(err.response?.status);

    console.log(err.response?.data);

    console.log(err.cause);

    throw err;
}
    return response.data.access_token;
}

module.exports = {
    getAccessToken,
    agent
};
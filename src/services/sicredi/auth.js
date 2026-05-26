const axios = require("axios");
const https = require("https");
const fs = require("fs");

const cert = fs.readFileSync(process.env.SICREDI_CERT_PATH);
const key = fs.readFileSync(process.env.SICREDI_KEY_PATH);

const agent = new https.Agent({
    cert,
    key,
    rejectUnauthorized: false
});

async function getAccessToken() {

    const auth = Buffer.from(
        `${process.env.SICREDI_CLIENT_ID}:${process.env.SICREDI_CLIENT_SECRET}`
    ).toString("base64");

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
}

module.exports = {
    getAccessToken,
    agent
};
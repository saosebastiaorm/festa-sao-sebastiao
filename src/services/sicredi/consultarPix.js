const axios = require("axios");

const {
    getAccessToken,
    agent
} = require("./auth");

async function consultarPix(txid) {

    const token = await getAccessToken();

    const response = await axios.get(

        `${process.env.SICREDI_BASE_URL}/api/v2/cob/${txid}`,

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
    consultarPix
};
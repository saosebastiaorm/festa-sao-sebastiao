/* =====================================================
   ARQUIVO: src/services/cartelas/qrcode-gerador.js

   Gera o QR code (PNG, como Buffer) usando a biblioteca
   "qrcode" do npm — já validada e amplamente usada, sem
   depender de bibliotecas nativas externas.
===================================================== */

const QRCode = require("qrcode");

/**
 * Gera um QR code como Buffer PNG.
 * @param {string} conteudo - URL ou texto a codificar
 * @param {number} tamanho - largura/altura em px (padrão 300)
 * @returns {Promise<Buffer>}
 */
async function gerarQRCodeBuffer(conteudo, tamanho = 300) {
  return QRCode.toBuffer(conteudo, {
    type: "png",
    width: tamanho,
    margin: 2,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });
}

module.exports = {
  gerarQRCodeBuffer,
};

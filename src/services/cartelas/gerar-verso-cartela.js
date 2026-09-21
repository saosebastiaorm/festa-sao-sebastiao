/* =====================================================
   ARQUIVO: src/services/cartelas/gerar-verso-cartela.js

   Gera o verso da cartela digital: arte oficial do verso
   com o cupom do 4º e 5º prêmio já preenchido com os dados
   do comprador (nome, CPF, endereço, cidade, telefone) e uma
   etiqueta com o número da cartela, ligando o cupom à cartela.
===================================================== */

const sharp = require("sharp");
const COORD = require("./coordenadas-arte");
const { escapar, formatarCpf, formatarTelefone, montarEndereco, svgCampo } = require("./campos-cartela");

function svgPicote() {
  const { y, x0, x1 } = COORD.PICOTE;
  const cx = (x0 + x1) / 2;
  const textoY = y + 11;

  return `
    <line x1="${x0}" y1="${y}" x2="${cx - 170}" y2="${y}" stroke="#ffffff" stroke-width="5" stroke-dasharray="22 14" />
    <line x1="${cx + 170}" y1="${y}" x2="${x1}" y2="${y}" stroke="#ffffff" stroke-width="5" stroke-dasharray="22 14" />
    <text x="${cx}" y="${textoY}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="32" text-anchor="middle" fill="#ffffff">CORTE AQUI - PICOTE</text>
  `;
}

async function gerarVersoCartelaPNG(dados, caminhoArteVerso) {
  const V = COORD.VERSO;
  const e = V.etiqueta;

  const svg = `
    <svg width="${COORD.LARGURA_IMAGEM}" height="${COORD.ALTURA_IMAGEM}" xmlns="http://www.w3.org/2000/svg">
      ${svgPicote()}
      <rect x="${e.x}" y="${e.y}" width="${e.largura}" height="${e.altura}" rx="14" fill="#ffffff" stroke="#f5b400" stroke-width="4" />
      <text x="${e.x + e.largura / 2}" y="${e.y + 39}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="30" text-anchor="middle" fill="#8b0000">CARTELA Nº ${escapar(dados.numeroChance1)} / ${escapar(dados.numeroChance2)}</text>
      ${svgCampo(dados.nomeComprador, V.nome)}
      ${svgCampo(formatarCpf(dados.cpfComprador), V.cpf)}
      ${svgCampo(montarEndereco(dados), V.endereco)}
      ${svgCampo(dados.cidade, V.cidade)}
      ${svgCampo(formatarTelefone(dados.whatsappComprador), V.telefone)}
    </svg>
  `;

  return sharp(caminhoArteVerso)
    .resize(COORD.LARGURA_IMAGEM, COORD.ALTURA_IMAGEM)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png({ quality: 80, compressionLevel: 8 })
    .toBuffer();
}

module.exports = {
  gerarVersoCartelaPNG,
};

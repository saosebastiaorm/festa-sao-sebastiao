/* =====================================================
   ARQUIVO: src/services/cartelas/gerar-cartela-digital.js

   Gera a imagem final da cartela digital: parte da arte
   oficial (imagem base) e compõe por cima uma camada SVG com:
     - os números das 2 grades (chance1 e chance2), repetidos
       nas 3 colunas de prêmio
     - 2 códigos de barra (chance1 + chance2) + números de série
     - textos de conferência (número + grade) nas 4 barras
       antes do 4º prêmio
     - QR code real (link do site) + chamada de "pague sua
       cartela ou peça seu churrasco"

   Equivalente em Node ao protótipo Python já validado neste
   projeto — mesma lógica, mesmas coordenadas.
===================================================== */

const sharp = require("sharp");
const { gerarCode128SVG } = require("./code128");
const { gerarQRCodeBuffer } = require("./qrcode-gerador");
const COORD = require("./coordenadas-arte");

const TAMANHOS_COLUNA = [5, 5, 4, 5, 5];

function distribuirEmColunas(numeros24) {
  const colunas = [];
  let idx = 0;
  for (const tamanho of TAMANHOS_COLUNA) {
    colunas.push(numeros24.slice(idx, idx + tamanho));
    idx += tamanho;
  }
  return colunas;
}

function svgGrade(premio, yLinhas, numeros24) {
  const colunasNumeros = distribuirEmColunas(numeros24);
  const xs = COORD.PREMIO_X[premio];
  const partes = [];

  colunasNumeros.forEach((numerosColuna, colIdx) => {
    const x = xs[colIdx];

    const linhasDisponiveis =
      colIdx === COORD.COLUNA_MEIO_INDEX ? [0, 1, 3, 4] : [0, 1, 2, 3, 4];

    numerosColuna.forEach((numero, i) => {
      const linhaIdx = linhasDisponiveis[i];
      const y = yLinhas[linhaIdx];
      const texto = String(numero).padStart(2, "0");

      partes.push(`
        <ellipse cx="${x}" cy="${y}" rx="${COORD.BOLINHA_LARGURA / 2}" ry="${COORD.BOLINHA_ALTURA / 2}" fill="${COORD.COR_BOLINHA}" />
        <text x="${x}" y="${y + 9}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="34" text-anchor="middle" fill="${COORD.COR_TEXTO}">${texto}</text>
      `);
    });
  });

  return partes.join("\n");
}

function svgCodigosBarras(numeroChance1, numeroChance2) {
  const { x0, y0, x1, y1 } = COORD.REGIAO_CODIGO_BARRAS;
  const largura = x1 - x0;
  const altura = y1 - y0;
  const metadeAltura = altura / 2;

  const partes = [
    `<rect x="${x0 - 4}" y="${y0 - 4}" width="${largura + 8}" height="${altura + 34}" fill="#ffffff" />`,
  ];

  [numeroChance1, numeroChance2].forEach((numero, i) => {
    const { svg: svgBarcode, largura: larguraBarcode } = gerarCode128SVG(numero, {
      alturaModulo: 50,
      larguraModulo: 2.2,
    });

    const escalaFinal = (largura - 30) / larguraBarcode;
    const larguraFinal = larguraBarcode * escalaFinal;
    const alturaFinal = 50 * escalaFinal;

    const posX = x0 + (largura - larguraFinal) / 2;
    const posY = y0 + 6 + i * metadeAltura;

    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svgBarcode).toString("base64")}`;

    partes.push(
      `<image x="${posX}" y="${posY}" width="${larguraFinal}" height="${alturaFinal}" href="${dataUri}" />`
    );
    partes.push(
      `<text x="${x0 + largura / 2}" y="${posY + alturaFinal + 24}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="24" text-anchor="middle" fill="#1e1e1e">${numero}</text>`
    );
  });

  return partes.join("\n");
}

function svgTextosConferencia(dados) {
  const formatarGrade = (grade24) =>
    grade24.map((n) => String(n).padStart(2, "0")).join(" ");

  function escreverNaBarra(barra, texto, tamanhoFonte) {
    const cx = barra.x + barra.largura / 2;
    const cy = barra.y + barra.altura / 2 + tamanhoFonte * 0.32;
    return `<text x="${cx}" y="${cy}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="${tamanhoFonte}" text-anchor="middle" fill="#1e1e1e">${texto}</text>`;
  }

  return [
    escreverNaBarra(COORD.BARRA_SERIE_1, dados.numeroChance1, 22),
    escreverNaBarra(COORD.BARRA_GRADE_1, formatarGrade(dados.gradeChance1), 17),
    escreverNaBarra(COORD.BARRA_SERIE_2, dados.numeroChance2, 22),
    escreverNaBarra(COORD.BARRA_GRADE_2, formatarGrade(dados.gradeChance2), 17),
  ].join("\n");
}

async function svgBlocoQR(qrCodeBuffer) {
  const { x0, y0, x1 } = COORD.REGIAO_QR;
  const { y1 } = COORD.REGIAO_QR;
  const altura = y1 - y0;

  const alturaCard = altura * 0.92;
  const larguraCard = alturaCard * 0.66;
  const cardX1 = x1 - 6;
  const cardX0 = cardX1 - larguraCard;
  const cardY0 = y0 + (altura - alturaCard) / 2;
  const cx = cardX0 + larguraCard / 2;

  const qrDataUri = `data:image/png;base64,${qrCodeBuffer.toString("base64")}`;
  const qrTamanho = larguraCard * 0.62;
  const qrX = cx - qrTamanho / 2;
  const qrY = cardY0 + 70;

  return `
    <rect x="${cardX0}" y="${cardY0}" width="${larguraCard}" height="${alturaCard}" rx="10" fill="#ffffff" stroke="#8b0000" stroke-width="3" />
    <text x="${cx}" y="${cardY0 + 28}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="24" text-anchor="middle" fill="#8b0000">ESCANEIE E</text>
    <text x="${cx}" y="${cardY0 + 56}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="24" text-anchor="middle" fill="#8b0000">PAGUE SUA CARTELA</text>
    <text x="${cx}" y="${cardY0 + 86}" font-family="Helvetica, Arial, sans-serif" font-size="18" text-anchor="middle" fill="#1e1e1e">ou peça seu</text>
    <text x="${cx}" y="${cardY0 + 110}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="19" text-anchor="middle" fill="#c88200">CHURRASCO</text>
    <text x="${cx}" y="${cardY0 + 132}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="19" text-anchor="middle" fill="#c88200">ANTECIPADO</text>
    <image x="${qrX}" y="${qrY}" width="${qrTamanho}" height="${qrTamanho}" href="${qrDataUri}" />
    <text x="${cx}" y="${qrY + qrTamanho + 22}" font-family="Helvetica, Arial, sans-serif" font-size="15" text-anchor="middle" fill="#1e1e1e">festasaosebastiao.com.br</text>
  `;
}

async function gerarCartelaDigitalPNG(dados, caminhoArteBase) {
  const qrCodeBuffer = await gerarQRCodeBuffer("https://festasaosebastiao.com.br", 280);

  const partesSVG = [];

  for (const premio of [1, 2, 3]) {
    partesSVG.push(svgGrade(premio, COORD.Y_CHANCE1, dados.gradeChance1));
    partesSVG.push(svgGrade(premio, COORD.Y_CHANCE2, dados.gradeChance2));
  }

  partesSVG.push(svgCodigosBarras(dados.numeroChance1, dados.numeroChance2));

  partesSVG.push(
    svgTextosConferencia({
      numeroChance1: dados.numeroChance1,
      numeroChance2: dados.numeroChance2,
      gradeChance1: dados.gradeChance1,
      gradeChance2: dados.gradeChance2,
    })
  );

  const { x0, y0, x1, y1 } = COORD.REGIAO_QR;
  partesSVG.push(
    `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#fdf6ee" />`
  );
  partesSVG.push(await svgBlocoQR(qrCodeBuffer));

  const svgCompleto = `
    <svg width="${COORD.LARGURA_IMAGEM}" height="${COORD.ALTURA_IMAGEM}" xmlns="http://www.w3.org/2000/svg">
      ${partesSVG.join("\n")}
    </svg>
  `;

  const overlayBuffer = Buffer.from(svgCompleto);

  const resultado = await sharp(caminhoArteBase)
    .resize(COORD.LARGURA_IMAGEM, COORD.ALTURA_IMAGEM)
    .composite([{ input: overlayBuffer, top: 0, left: 0 }])
    .png({ quality: 80, compressionLevel: 8 })
    .toBuffer();

  return resultado;
}

module.exports = {
  gerarCartelaDigitalPNG,
};

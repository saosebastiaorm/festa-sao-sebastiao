/* =====================================================
   ARQUIVO: src/services/cartelas/gerar-cartela-digital.js

   Gera a imagem final da cartela digital: parte da arte
   oficial (imagem base, ver coordenadas-arte.js) e compõe
   por cima uma camada SVG com:
     - os números das 2 grades (chance1 e chance2), repetidos
       nas 3 colunas de prêmio, direto sobre as bolinhas da arte
     - 2 códigos de barra (chance1 + chance2) + números de série,
       na área livre do quadro "Nome/CPF/End." do topo
     - os números da cartela no campo "SORTEIO ____" do canhoto
       do rodapé (4º e 5º prêmio) e na faixa branca vertical, ao
       lado da "Dupla Chance" do 1º prêmio
     - o formulário do topo (nome, CPF, endereço, telefone, vendedor
       e forma de pagamento) já preenchido com os dados da compra

   O QR code de pagamento já faz parte da arte oficial.
===================================================== */

const sharp = require("sharp");
const { gerarCode128SVG } = require("./code128");
const COORD = require("./coordenadas-arte");
const { escapar, formatarCpf, formatarTelefone, montarEndereco, svgCampo } = require("./campos-cartela");

function svgGrade(premio, chance, numeros24) {
  const centros = COORD.BOLINHAS[`${premio}-${chance}`];
  const partes = [];

  numeros24.forEach((numero, i) => {
    const [x, y] = centros[i];
    const texto = String(numero).padStart(2, "0");

    partes.push(
      `<text x="${x}" y="${y + COORD.FONTE_NUMERO * 0.35}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="${COORD.FONTE_NUMERO}" text-anchor="middle" fill="${COORD.COR_TEXTO}">${texto}</text>`
    );
  });

  return partes.join("\n");
}

function svgCodigosBarras(numeroChance1, numeroChance2) {
  const { x0, y0, x1, y1 } = COORD.REGIAO_CODIGO_BARRAS;
  const largura = x1 - x0;
  const altura = y1 - y0;
  const metadeAltura = altura / 2;

  const partes = [];

  [numeroChance1, numeroChance2].forEach((numero, i) => {
    const { svg: svgBarcode, largura: larguraBarcode } = gerarCode128SVG(numero, {
      alturaModulo: 60,
      larguraModulo: 2.2,
    });

    const escalaFinal = (largura - 30) / larguraBarcode;
    const larguraFinal = larguraBarcode * escalaFinal;
    const alturaFinal = 60 * escalaFinal;

    const posX = x0 + (largura - larguraFinal) / 2;
    const posY = y0 + 6 + i * metadeAltura;

    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svgBarcode).toString("base64")}`;

    partes.push(
      `<image x="${posX}" y="${posY}" width="${larguraFinal}" height="${alturaFinal}" href="${dataUri}" />`
    );
    partes.push(
      `<text x="${x0 + largura / 2}" y="${posY + alturaFinal + 28}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="28" text-anchor="middle" fill="#1e1e1e">${numero}</text>`
    );
  });

  return partes.join("\n");
}

function svgNumeroRodape(numeroChance1, numeroChance2) {
  const { x, y, largura, altura } = COORD.CAMPO_SORTEIO_RODAPE;
  const cx = x + largura / 2;
  const cy = y + altura / 2 + 27 * 0.35;

  return `<text x="${cx}" y="${cy}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="27" text-anchor="middle" fill="#1e1e1e">${numeroChance1} / ${numeroChance2}</text>`;
}

function svgNumerosFaixaLateral(numeroChance1, numeroChance2) {
  const { xCentro, fonte } = COORD.FAIXA_LATERAL;
  const centroY = chance => {
    const ys = COORD.BOLINHAS[`1-${chance}`].map(([, y]) => y);
    return (Math.min(...ys) + Math.max(...ys)) / 2;
  };

  return [[numeroChance1, centroY(1)], [numeroChance2, centroY(2)]]
    .map(([numero, y]) => `<text transform="translate(${xCentro} ${y}) rotate(-90)" x="0" y="${fonte * 0.36}" font-family="Helvetica, Arial, sans-serif" font-size="${fonte}" text-anchor="middle" fill="#1e1e1e">${escapar(numero)}</text>`)
    .join("\n");
}

function svgFormularioTopo(dados) {
  const F = COORD.FORMULARIO_TOPO;
  const enderecoCompleto = [montarEndereco(dados), dados.cidade].filter(Boolean).join(", ");

  return [
    svgCampo(dados.nomeComprador, F.nome),
    svgCampo(formatarCpf(dados.cpfComprador), F.cpf),
    svgCampo(enderecoCompleto, F.endereco),
    svgCampo(formatarTelefone(dados.whatsappComprador), F.telefone),
    svgCampo("www.festasaosebastiao.com.br", F.vendedor),
    `<text x="${F.marcaPix.x}" y="${F.marcaPix.y}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="40" text-anchor="middle" fill="#10286b">x</text>`,
  ].join("\n");
}

async function gerarCartelaDigitalPNG(dados, caminhoArteBase) {
  const partesSVG = [];

  for (const premio of [1, 2, 3]) {
    partesSVG.push(svgGrade(premio, 1, dados.gradeChance1));
    partesSVG.push(svgGrade(premio, 2, dados.gradeChance2));
  }

  partesSVG.push(svgCodigosBarras(dados.numeroChance1, dados.numeroChance2));
  partesSVG.push(svgNumeroRodape(dados.numeroChance1, dados.numeroChance2));
  partesSVG.push(svgNumerosFaixaLateral(dados.numeroChance1, dados.numeroChance2));
  partesSVG.push(svgFormularioTopo(dados));

  const svgCompleto = `
    <svg width="${COORD.LARGURA_IMAGEM}" height="${COORD.ALTURA_IMAGEM}" xmlns="http://www.w3.org/2000/svg">
      ${partesSVG.join("\n")}
    </svg>
  `;

  const overlayBuffer = Buffer.from(svgCompleto);

  // OBS: a opção "quality" no .png() do sharp ativa quantização de cor
  // (reduz pra paleta), que é MUITO cara de CPU (~12x mais lenta em teste
  // local) e ainda piora a qualidade visual. Removida de propósito — o
  // compressionLevel sozinho já cuida do tamanho do arquivo sem esse custo.
  const resultado = await sharp(caminhoArteBase)
    .resize(COORD.LARGURA_IMAGEM, COORD.ALTURA_IMAGEM)
    .composite([{ input: overlayBuffer, top: 0, left: 0 }])
    .png({ compressionLevel: 8 })
    .toBuffer();

  return resultado;
}

module.exports = {
  gerarCartelaDigitalPNG,
};

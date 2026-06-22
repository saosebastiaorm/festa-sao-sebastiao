/* =====================================================
   ARQUIVO: src/services/cartelas/code128.js

   Gera um código de barras Code 128 (subset B) como string
   SVG — sem depender de nenhuma biblioteca de imagem nativa.
   A tabela de padrões foi validada manualmente contra fontes
   públicas documentadas do padrão Code 128 (mesma validação
   já feita na versão Python deste projeto).
===================================================== */

const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213",
  "122312", "132212", "221213", "221312", "231212", "112232", "122132",
  "122231", "113222", "123122", "123221", "223211", "221132", "221231",
  "213212", "223112", "312131", "311222", "321122", "321221", "312212",
  "322112", "322211", "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121", "313121",
  "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111",
  "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114",
  "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121",
  "412121", "111143", "111341", "131141", "114113", "114311", "411113",
  "411311", "113141", "114131", "311141", "411131",
  "211412", "211214", "211232",
];

const START_B = 104;
const STOP_PATTERN = "2331112";

function encodeCode128B(texto) {
  const valores = [START_B];

  for (const char of texto) {
    const codigoAscii = char.codePointAt(0);
    if (codigoAscii < 32 || codigoAscii > 126) {
      throw new Error(
        `Caractere "${char}" fora do subset B do Code 128 (use apenas ASCII 32-126).`
      );
    }
    valores.push(codigoAscii - 32);
  }

  let checksum = valores[0];
  for (let i = 1; i < valores.length; i++) {
    checksum += valores[i] * i;
  }
  checksum %= 103;
  valores.push(checksum);

  const larguras = valores.map((v) => CODE128_PATTERNS[v]);
  return { larguras, stop: STOP_PATTERN };
}

/**
 * Gera o SVG do código de barras Code 128 para o texto informado.
 * @param {string} texto - texto a codificar (ex: "90015-37")
 * @param {object} opcoes
 * @param {number} opcoes.alturaModulo - altura das barras em px (padrão 60)
 * @param {number} opcoes.larguraModulo - largura de 1 módulo em px (padrão 2.2)
 * @param {number} opcoes.margemModulos - margem (quiet zone) em módulos (padrão 10)
 * @returns {{svg: string, largura: number, altura: number}}
 */
function gerarCode128SVG(texto, opcoes = {}) {
  const alturaModulo = opcoes.alturaModulo || 60;
  const larguraModulo = opcoes.larguraModulo || 2.2;
  const margemModulos = opcoes.margemModulos ?? 10;

  const { larguras, stop } = encodeCode128B(texto);

  const sequencia = [];
  for (const codigo of larguras) {
    let ehBarra = true;
    for (const digito of codigo) {
      sequencia.push([Number(digito), ehBarra]);
      ehBarra = !ehBarra;
    }
  }
  let ehBarra = true;
  for (const digito of stop) {
    sequencia.push([Number(digito), ehBarra]);
    ehBarra = !ehBarra;
  }

  const totalModulos =
    sequencia.reduce((acc, [largura]) => acc + largura, 0) + 2 * margemModulos;
  const larguraTotal = totalModulos * larguraModulo;

  let x = margemModulos * larguraModulo;
  const retangulos = [];

  for (const [larguraModulos, ehBarraAtual] of sequencia) {
    const larguraPx = larguraModulos * larguraModulo;
    if (ehBarraAtual) {
      retangulos.push(
        `<rect x="${x.toFixed(2)}" y="0" width="${larguraPx.toFixed(2)}" height="${alturaModulo}" fill="#000000" />`
      );
    }
    x += larguraPx;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${larguraTotal.toFixed(2)}" height="${alturaModulo}" viewBox="0 0 ${larguraTotal.toFixed(2)} ${alturaModulo}">
<rect x="0" y="0" width="${larguraTotal.toFixed(2)}" height="${alturaModulo}" fill="#ffffff" />
${retangulos.join("\n")}
</svg>`;

  return { svg, largura: larguraTotal, altura: alturaModulo };
}

module.exports = {
  gerarCode128SVG,
  encodeCode128B,
};

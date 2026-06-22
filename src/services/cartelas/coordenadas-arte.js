/* =====================================================
   ARQUIVO: src/services/cartelas/coordenadas-arte.js

   Coordenadas mapeadas manualmente na arte oficial da
   cartela 2027 (imagem em 2550x3300px, 300dpi), validadas
   na versão Python deste projeto. Qualquer mudança na arte
   exige remapear estas coordenadas.
===================================================== */

// Posição X (centro) de cada uma das 5 colunas (S,O,R,T,E),
// para cada uma das 3 colunas de prêmio
const PREMIO_X = {
  1: [386, 500, 614, 730, 844],
  2: [1068, 1180, 1293, 1407, 1519],
  3: [1747, 1859, 1972, 2086, 2198],
};

// Posição Y (centro) de cada uma das 5 linhas, para cada chance
const Y_CHANCE1 = [1418, 1490, 1562, 1634, 1706];
const Y_CHANCE2 = [1888, 1959, 2031, 2104, 2174];

// A coluna do meio ("R") tem só 4 números — a 3ª linha (index 2)
// é ocupada por logo de patrocinador
const COLUNA_MEIO_INDEX = 2;
const LINHA_BURACO_INDEX = 2;

const BOLINHA_LARGURA = 99;
const BOLINHA_ALTURA = 67;
const COR_BOLINHA = "#eeeeee";
const COR_TEXTO = "#1e1e1e";

// Região do bloco QR/balão Pix-Cartões (substituído pelo novo
// QR + chamada de "escaneie e pague")
const REGIAO_QR = { x0: 300, y0: 690, x1: 1060, y1: 1010 };

// Espaço reservado (retângulo cinza original) para os 2 códigos
// de barra + números de série, no canto superior direito
const REGIAO_CODIGO_BARRAS = { x0: 2074, y0: 110, x1: 2380, y1: 320 };

// As 4 barras vazias de conferência, antes do 4º prêmio
const BARRA_SERIE_1 = { x: 260, y: 2877, largura: 221, altura: 33 };
const BARRA_GRADE_1 = { x: 494, y: 2877, largura: 799, altura: 33 };
const BARRA_SERIE_2 = { x: 1339, y: 2877, largura: 221, altura: 33 };
const BARRA_GRADE_2 = { x: 1573, y: 2877, largura: 802, altura: 33 };

const LARGURA_IMAGEM = 2550;
const ALTURA_IMAGEM = 3300;

module.exports = {
  PREMIO_X,
  Y_CHANCE1,
  Y_CHANCE2,
  COLUNA_MEIO_INDEX,
  LINHA_BURACO_INDEX,
  BOLINHA_LARGURA,
  BOLINHA_ALTURA,
  COR_BOLINHA,
  COR_TEXTO,
  REGIAO_QR,
  REGIAO_CODIGO_BARRAS,
  BARRA_SERIE_1,
  BARRA_GRADE_1,
  BARRA_SERIE_2,
  BARRA_GRADE_2,
  LARGURA_IMAGEM,
  ALTURA_IMAGEM,
};

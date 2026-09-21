/* =====================================================
   ARQUIVO: src/services/cartelas/coordenadas-arte.js

   Coordenadas da arte oficial da cartela 2027
   (assets/arte-cartela-2027-oficial.png, 2599x3780px, 300dpi,
   formato 220x320mm), extraidas diretamente do PDF oficial
   ("Cartela - Frente.pdf"): cada bolinha e uma imagem
   posicionada no PDF, entao os centros abaixo sao exatos.
   Qualquer mudanca na arte exige remapear estas coordenadas.
===================================================== */

const LARGURA_IMAGEM = 2599;
const ALTURA_IMAGEM = 3780;

// Centro [x, y] das 24 bolinhas de cada grade, na ordem em que os
// numeros sao distribuidos: coluna a coluna (S,O,R,T,E => 5,5,4,5,5),
// de cima pra baixo. Chave: "<premio>-<chance>" (premio 1..3, chance 1..2).
// A 3a coluna (R) tem so 4 numeros: o meio e o logo do patrocinador.
const BOLINHAS = {
  "1-1": [[440, 1718], [440, 1793], [440, 1867], [440, 1943], [444, 2016], [552, 1718], [552, 1793], [549, 1867], [552, 1943], [556, 2016], [664, 1718], [661, 1794], [664, 1943], [668, 2016], [778, 1718], [778, 1793], [781, 1867], [778, 1943], [782, 2016], [889, 1718], [889, 1793], [889, 1867], [889, 1943], [893, 2016]],
  "1-2": [[441, 2197], [441, 2271], [441, 2345], [441, 2419], [446, 2493], [554, 2197], [554, 2271], [551, 2345], [554, 2419], [558, 2493], [666, 2197], [666, 2271], [666, 2420], [670, 2493], [779, 2197], [779, 2271], [783, 2345], [779, 2419], [784, 2493], [890, 2197], [890, 2271], [890, 2345], [890, 2419], [895, 2493]],
  "2-1": [[1115, 1720], [1115, 1796], [1115, 1871], [1115, 1947], [1119, 2020], [1226, 1720], [1226, 1796], [1222, 1871], [1226, 1947], [1230, 2020], [1336, 1720], [1336, 1796], [1336, 1947], [1340, 2020], [1448, 1720], [1448, 1796], [1451, 1871], [1448, 1947], [1452, 2020], [1558, 1720], [1558, 1796], [1558, 1871], [1558, 1947], [1562, 2020]],
  "2-2": [[1117, 2201], [1117, 2275], [1117, 2349], [1117, 2421], [1121, 2495], [1227, 2201], [1227, 2275], [1224, 2349], [1227, 2421], [1232, 2495], [1338, 2201], [1338, 2275], [1338, 2421], [1342, 2495], [1450, 2201], [1450, 2275], [1454, 2349], [1450, 2421], [1454, 2495], [1559, 2201], [1559, 2275], [1559, 2349], [1559, 2421], [1564, 2495]],
  "3-1": [[1769, 1723], [1769, 1799], [1769, 1873], [1769, 1951], [1773, 2024], [1880, 1723], [1880, 1799], [1877, 1875], [1880, 1951], [1884, 2024], [1990, 1723], [1990, 1799], [1990, 1951], [1994, 2024], [2102, 1723], [2102, 1799], [2105, 1875], [2102, 1951], [2107, 2024], [2212, 1723], [2212, 1799], [2212, 1875], [2212, 1951], [2216, 2024]],
  "3-2": [[1771, 2202], [1773, 2279], [1772, 2350], [1772, 2424], [1775, 2498], [1881, 2202], [1881, 2279], [1878, 2350], [1881, 2424], [1886, 2498], [1992, 2202], [1992, 2279], [1992, 2424], [1996, 2498], [2104, 2202], [2104, 2279], [2107, 2350], [2104, 2424], [2108, 2498], [2213, 2202], [2213, 2279], [2213, 2350], [2213, 2424], [2217, 2498]],
};

const FONTE_NUMERO = 36;
const COR_TEXTO = "#1e1e1e";

// Area branca livre, no canto direito do quadro "Nome/CPF/End." do topo,
// reservada para os 2 codigos de barra + numeros de serie
const REGIAO_CODIGO_BARRAS = { x0: 2050, y0: 300, x1: 2395, y1: 590 };

// Campo branco "SORTEIO ____" do canhoto do rodape (4o e 5o premio),
// onde vai o numero da cartela
const CAMPO_SORTEIO_RODAPE = { x: 435, y: 3335, largura: 350, altura: 52 };

// Formulario do topo da frente (linhas Nome/CPF/End./Tel./Vendedor) e a marca
// "( )Pix no Site" da forma de pagamento
const FORMULARIO_TOPO = {
  nome: { x0: 590, x1: 1408, y: 392 },
  cpf: { x0: 1522, x1: 2000, y: 392 },
  endereco: { x0: 555, x1: 1515, y: 487 },
  telefone: { x0: 1624, x1: 2000, y: 487 },
  vendedor: { x0: 1443, x1: 2000, y: 582 },
  marcaPix: { x: 802, y: 577 },
};

// Faixa branca vertical, a esquerda da "Dupla Chance" do 1o premio: recebe os
// numeros da cartela na vertical (chance 1 na grade de cima, chance 2 na de baixo)
const FAIXA_LATERAL = { xCentro: 269, fonte: 50 };

// Cupom do verso (assets/arte-cartela-2027-verso.png, mesma dimensao da frente):
// linhas para preencher (x0..x1 na horizontal, y = linha de base) e a etiqueta
// com o numero da cartela, acima do cupom
// Picote (linha de corte do canhoto) acima da etiqueta do numero da cartela
const PICOTE = { y: 3105, x0: 150, x1: 2450 };

const VERSO = {
  nome: { x0: 765, x1: 1750, y: 3326 },
  cpf: { x0: 1848, x1: 2380, y: 3326 },
  endereco: { x0: 805, x1: 1375, y: 3376 },
  cidade: { x0: 1552, x1: 1950, y: 3376 },
  telefone: { x0: 2020, x1: 2380, y: 3376 },
  etiqueta: { x: 1790, y: 3216, largura: 615, altura: 58 },
};

module.exports = {
  LARGURA_IMAGEM,
  ALTURA_IMAGEM,
  BOLINHAS,
  FONTE_NUMERO,
  COR_TEXTO,
  REGIAO_CODIGO_BARRAS,
  CAMPO_SORTEIO_RODAPE,
  VERSO,
  PICOTE,
  FORMULARIO_TOPO,
  FAIXA_LATERAL,
};

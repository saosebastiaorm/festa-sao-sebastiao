/* =====================================================
   ARQUIVO: src/services/cartelas/importar-lote.js

   Lê e valida uma planilha (.xlsx) de cartelas novas pra um lote.
   Não grava nada no banco — só transforma o arquivo em duas listas
   (válidas/inválidas), pra rota em server.js decidir se grava.

   Colunas esperadas na planilha (linha 1 = cabeçalho):
     física:  numero_chance1, numero_chance2         (formato NNNNN-DD)
     digital: numero_chance1, numero_chance2,
              grade_chance1, grade_chance2            (24 números cada,
                                                        separados por
                                                        vírgula/espaço)
===================================================== */

const ExcelJS = require("exceljs");
const { validarNumeroFormatado, validarGrade } = require("./dv");

async function lerPlanilha(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const aba = workbook.worksheets[0];

  if (!aba) return [];

  const cabecalho = [];
  aba.getRow(1).eachCell({ includeEmpty: false }, (celula, coluna) => {
    cabecalho[coluna] = String(celula.value ?? "").trim().toLowerCase();
  });

  const linhas = [];
  aba.eachRow((linha, numeroLinha) => {
    if (numeroLinha === 1) return; // cabeçalho

    const objeto = {};
    linha.eachCell({ includeEmpty: true }, (celula, coluna) => {
      const nomeColuna = cabecalho[coluna];
      if (nomeColuna) objeto[nomeColuna] = celula.value ?? "";
    });

    // ignora linhas totalmente vazias (comuns no fim de planilhas exportadas)
    if (Object.values(objeto).some((v) => String(v).trim() !== "")) {
      linhas.push(objeto);
    }
  });

  return linhas;
}

function parseGrade(valor) {
  if (Array.isArray(valor)) return valor.map(Number);
  return String(valor || "")
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map(Number);
}

/* ===== VALIDA CADA LINHA E MONTA AS CARTELAS PRONTAS PRA INSERIR =====
   loteChave/tipo vêm do lote alvo (server.js já buscou antes de chamar isso). */
function validarLinhas(linhas, { loteChave, tipo }) {
  const ehDigital = tipo === "digital";
  const invalidas = [];
  const validas = [];
  const vistosNoArquivo = new Set();

  linhas.forEach((linha, indice) => {
    const numeroLinha = indice + 2; // +1 pelo cabeçalho, +1 porque índice começa em 0

    const v1 = validarNumeroFormatado(linha.numero_chance1);
    const v2 = validarNumeroFormatado(linha.numero_chance2);

    if (!v1.valido) {
      invalidas.push({ linha: numeroLinha, motivo: `numero_chance1 inválido (${linha.numero_chance1})` });
      return;
    }
    if (!v2.valido) {
      invalidas.push({ linha: numeroLinha, motivo: `numero_chance2 inválido (${linha.numero_chance2})` });
      return;
    }

    const chance1 = String(linha.numero_chance1).trim();
    const chance2 = String(linha.numero_chance2).trim();

    if (chance1 === chance2) {
      invalidas.push({ linha: numeroLinha, motivo: "numero_chance1 e numero_chance2 são iguais" });
      return;
    }

    if (vistosNoArquivo.has(chance1) || vistosNoArquivo.has(chance2)) {
      invalidas.push({ linha: numeroLinha, motivo: "número repetido dentro da própria planilha" });
      return;
    }

    let gradeChance1 = null;
    let gradeChance2 = null;

    if (ehDigital) {
      gradeChance1 = parseGrade(linha.grade_chance1);
      gradeChance2 = parseGrade(linha.grade_chance2);

      if (!validarGrade(gradeChance1)) {
        invalidas.push({ linha: numeroLinha, motivo: "grade_chance1 fora do padrão SORTE (24 números, faixas/ordem corretas)" });
        return;
      }
      if (!validarGrade(gradeChance2)) {
        invalidas.push({ linha: numeroLinha, motivo: "grade_chance2 fora do padrão SORTE (24 números, faixas/ordem corretas)" });
        return;
      }
    }

    vistosNoArquivo.add(chance1);
    vistosNoArquivo.add(chance2);

    validas.push({
      numero_chance1: chance1,
      numero_chance2: chance2,
      tipo,
      lote: loteChave,
      status: "disponivel",
      grade_chance1: gradeChance1,
      grade_chance2: gradeChance2
    });
  });

  return { validas, invalidas };
}

async function processarPlanilha(buffer, loteAlvo) {
  const linhas = await lerPlanilha(buffer);
  const { validas, invalidas } = validarLinhas(linhas, loteAlvo);

  return {
    total_linhas: linhas.length,
    validas,
    invalidas
  };
}

module.exports = { processarPlanilha, lerPlanilha, validarLinhas };

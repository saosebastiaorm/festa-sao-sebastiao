/* =====================================================
   ARQUIVO: src/services/cartelas/dv.js

   Dígito Verificador (DV) das cartelas — modelo empírico derivado
   dos dados da 1ª remessa oficial (não é uma fórmula documentada
   pelo gerenciador do bingo, foi deduzida e validada 100% contra
   as ~21.000 cartelas reais recebidas). Ver migration/dv-model.js
   pra o histórico da validação original.

   Usado tanto na carga inicial quanto na importação de remessas
   futuras pelo admin (validação de integridade antes de gravar).
===================================================== */

const mod = (a, m) => ((a % m) + m) % m;

function digitsOf(id) {
  return String(id).split("").reverse().map(Number); // d[0] = unidades
}

function calcularDV(id) {
  const d = digitsOf(id), L = d.length, d0 = d[0];
  let R1 = 0;
  d.forEach((x, p) => { R1 += (p + 2) * x; });
  R1 = mod(R1, 11);
  const T = R1 >= 2 ? 11 - R1 : (R1 === 0 ? 0 : d0);
  const r = R1 === 1
    ? mod(2 * (L - 3) * d0 + (10 - 2 * L), 11)
    : mod((9 - L) * R1 + (L + 2) * d0 + (9 - 2 * L), 11);
  const U = r >= 2 ? 11 - r : (r === 0 ? 0 : d0);
  return T * 10 + U;
}

const pad2 = (n) => String(n).padStart(2, "0");
const pad5 = (n) => String(n).padStart(5, "0");

/* Formata um id pro padrão impresso NNNNN-DD (física) — sempre com
   zeros à esquerda no id e no DV, confirmado contra cartelas reais. */
function formatarNumeroFisica(id) {
  return `${pad5(id)}-${pad2(calcularDV(id))}`;
}

/* Confere se uma string "NNNNN-DD" já pronta (vinda de uma planilha,
   por exemplo) bate com o DV recalculado — não confia no DV que veio
   no arquivo, sempre recalcula a partir do id. */
function validarNumeroFormatado(numero) {
  const m = /^(\d+)-(\d{2})$/.exec(String(numero || "").trim());
  if (!m) return { valido: false, motivo: "formato_invalido" };

  const id = Number(m[1]);
  const dvInformado = Number(m[2]);
  const dvCalculado = calcularDV(id);

  if (dvInformado !== dvCalculado) {
    return { valido: false, motivo: "dv_divergente", dvCalculado };
  }

  return { valido: true, id, dv: dvCalculado };
}

/* ===== GRADE DA CARTELA DIGITAL (S-O-R-T-E) =====
   5 colunas, faixas fixas, 24 números (25 casas - 1 livre no meio),
   em ordem crescente dentro de cada coluna, sem repetição. */
const FAIXAS_SORTE = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
const TAMANHO_COLUNA = [5, 5, 4, 5, 5]; // coluna R (meio) tem 4 por causa da casa livre

function validarGrade(grade) {
  if (!Array.isArray(grade) || grade.length !== 24) return false;
  if (new Set(grade).size !== 24) return false;

  let i = 0;
  return TAMANHO_COLUNA.every((tamanho, coluna) => {
    const valoresColuna = grade.slice(i, i + tamanho);
    i += tamanho;
    const [min, max] = FAIXAS_SORTE[coluna];
    return valoresColuna.every((valor, posicao) =>
      valor >= min && valor <= max && (posicao === 0 || valor > valoresColuna[posicao - 1])
    );
  });
}

module.exports = {
  calcularDV,
  formatarNumeroFisica,
  validarNumeroFormatado,
  validarGrade,
  pad2,
  pad5
};

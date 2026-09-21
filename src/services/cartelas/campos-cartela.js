/* =====================================================
   ARQUIVO: src/services/cartelas/campos-cartela.js

   Utilitários compartilhados pela frente e pelo verso da
   cartela digital: formatação dos dados do comprador e
   desenho de um texto preenchido sobre uma linha da arte.
===================================================== */

function escapar(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatarCpf(valor) {
  const d = String(valor || "").replace(/\D/g, "");
  if (d.length !== 11) return String(valor || "");
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatarTelefone(valor) {
  let d = String(valor || "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(valor || "");
}

function montarEndereco({ rua, numeroEndereco, bairro }) {
  const linha = [rua, numeroEndereco].filter(Boolean).join(", ");
  return [linha, bairro].filter(Boolean).join(" - ");
}

// Escreve o texto sobre uma linha da arte, reduzindo a fonte se não couber
function svgCampo(texto, caixa, tamanho = 38) {
  if (!texto) return "";
  const larguraUtil = caixa.x1 - caixa.x0 - 16;
  let fonte = tamanho;
  while (texto.length * fonte * 0.56 > larguraUtil && fonte > 20) fonte -= 1;

  return `<text x="${caixa.x0 + 8}" y="${caixa.y - 4}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="${fonte}" fill="#10286b">${escapar(texto)}</text>`;
}

module.exports = {
  escapar,
  formatarCpf,
  formatarTelefone,
  montarEndereco,
  svgCampo,
};

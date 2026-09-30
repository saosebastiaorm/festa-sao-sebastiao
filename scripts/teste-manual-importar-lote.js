/* Teste manual (não faz parte do smoke-test) — gera planilhas sintéticas
   em memória e roda o módulo de importação isolado, sem tocar o banco. */
const ExcelJS = require("exceljs");
const { calcularDV, formatarNumeroFisica } = require("../src/services/cartelas/dv");
const { processarPlanilha } = require("../src/services/cartelas/importar-lote");

async function gerarBufferFisica(linhas) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("cartelas");
  ws.addRow(["numero_chance1", "numero_chance2"]);
  linhas.forEach((l) => ws.addRow([l.numero_chance1, l.numero_chance2]));
  return wb.xlsx.writeBuffer();
}

async function gerarBufferDigital(linhas) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("cartelas");
  ws.addRow(["numero_chance1", "numero_chance2", "grade_chance1", "grade_chance2"]);
  linhas.forEach((l) => ws.addRow([l.numero_chance1, l.numero_chance2, l.grade_chance1, l.grade_chance2]));
  return wb.xlsx.writeBuffer();
}

function gradeValida() {
  // S(1-15,5) O(16-30,5) R(31-45,4) T(46-60,5) E(61-75,5) = 24 números
  return [1,2,3,4,5, 16,17,18,19,20, 31,32,33,34, 46,47,48,49,50, 61,62,63,64,65].join(",");
}

async function main() {
  let falhas = 0;
  const assert = (cond, msg) => {
    if (!cond) { console.error("FALHOU:", msg); falhas++; }
    else console.log("ok:", msg);
  };

  // ===== FÍSICA =====
  const id1 = 1, id2 = 2, id3 = 99999;
  const linhasFisica = [
    { numero_chance1: formatarNumeroFisica(id1), numero_chance2: formatarNumeroFisica(id1 + 100000) },
    { numero_chance1: formatarNumeroFisica(id2), numero_chance2: formatarNumeroFisica(id2 + 100000) },
    { numero_chance1: "00003-99", numero_chance2: formatarNumeroFisica(id3 + 100000) }, // DV errado de propósito
  ];
  const bufFisica = await gerarBufferFisica(linhasFisica);
  const resFisica = await processarPlanilha(bufFisica, { loteChave: "teste_import", tipo: "fisica" });

  assert(resFisica.total_linhas === 3, `total_linhas física = 3 (veio ${resFisica.total_linhas})`);
  assert(resFisica.validas.length === 2, `2 válidas na física (veio ${resFisica.validas.length})`);
  assert(resFisica.invalidas.length === 1, `1 inválida na física (veio ${resFisica.invalidas.length})`);
  assert(resFisica.invalidas[0].motivo.includes("numero_chance1"), "erro aponta numero_chance1 como inválido");
  assert(resFisica.validas[0].lote === "teste_import", "lote atribuído corretamente");
  assert(resFisica.validas[0].tipo === "fisica", "tipo atribuído corretamente");
  assert(resFisica.validas[0].status === "disponivel", "status inicial = disponivel");
  assert(resFisica.validas[0].grade_chance1 === null, "física não tem grade");

  // duplicado dentro do próprio arquivo
  const bufDuplicado = await gerarBufferFisica([
    { numero_chance1: formatarNumeroFisica(500), numero_chance2: formatarNumeroFisica(500 + 100000) },
    { numero_chance1: formatarNumeroFisica(500), numero_chance2: formatarNumeroFisica(501 + 100000) },
  ]);
  const resDuplicado = await processarPlanilha(bufDuplicado, { loteChave: "teste_import", tipo: "fisica" });
  assert(resDuplicado.validas.length === 1 && resDuplicado.invalidas.length === 1, "duplicado dentro do arquivo é pego");

  // ===== DIGITAL =====
  const linhasDigital = [
    {
      numero_chance1: formatarNumeroFisica(44001),
      numero_chance2: formatarNumeroFisica(49001),
      grade_chance1: gradeValida(),
      grade_chance2: gradeValida()
    },
    {
      numero_chance1: formatarNumeroFisica(44002),
      numero_chance2: formatarNumeroFisica(49002),
      grade_chance1: "1,2,3,4,5,6,16,17,18,19,20,31,32,33,34,46,47,48,49,50,61,62,63,64", // fora de ordem/faixa (6 na coluna S)
      grade_chance2: gradeValida()
    }
  ];
  const bufDigital = await gerarBufferDigital(linhasDigital);
  const resDigital = await processarPlanilha(bufDigital, { loteChave: "teste_import_digital", tipo: "digital" });

  assert(resDigital.validas.length === 1, `1 válida na digital (veio ${resDigital.validas.length})`);
  assert(resDigital.invalidas.length === 1, `1 inválida na digital (veio ${resDigital.invalidas.length})`);
  assert(resDigital.invalidas[0].motivo.includes("grade_chance1"), "erro aponta grade_chance1 fora do padrão");
  assert(Array.isArray(resDigital.validas[0].grade_chance1) && resDigital.validas[0].grade_chance1.length === 24, "grade válida tem 24 números");

  console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERRO NO TESTE:", e); process.exit(1); });

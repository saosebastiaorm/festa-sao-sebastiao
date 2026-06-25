/**
 * Script de limpeza — remove os arquivos órfãos confirmados no bucket
 * "produtos" do Supabase Storage (produtos que já foram excluídos do
 * banco, mas cujo arquivo de imagem nunca foi removido do Storage).
 *
 * Esta lista foi confirmada manualmente após a migração de otimização
 * de imagens (migrar-imagens-produtos.js) — são as 7 imagens que não
 * tiveram nenhuma linha correspondente na tabela "produtos".
 *
 * COMO USAR:
 *   1. cd F:\Site\fpss\fpss-backend
 *   2. node limpar-imagens-orfas.js
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERRO: SUPABASE_URL ou SUPABASE_KEY não encontrados no .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BUCKET = "produtos";

// Arquivos confirmados como órfãos (sem nenhum produto ativo os usando)
const ARQUIVOS_ORFAOS = [
  "Churrasco.webp",
  "Doacao.webp",
  "Por__es_Especiais.webp",
  "produto-1778306816688.webp",
  "produto-1779188569931.webp",
  "produto-1779189136374.webp",
  "Refrigerante_lata.webp",
];

async function main() {
  console.log("🗑️  Limpeza de imagens órfãs — bucket 'produtos'\n");
  console.log(`Apagando ${ARQUIVOS_ORFAOS.length} arquivo(s) confirmado(s) como sem uso:\n`);
  ARQUIVOS_ORFAOS.forEach((a) => console.log(`  - ${a}`));
  console.log("");

  const { data, error } = await supabase.storage.from(BUCKET).remove(ARQUIVOS_ORFAOS);

  if (error) {
    console.error("❌ ERRO ao remover arquivos:", error.message);
    process.exit(1);
  }

  console.log(`✅ ${data.length} arquivo(s) removido(s) com sucesso:`);
  data.forEach((d) => console.log(`   - ${d.name}`));

  if (data.length < ARQUIVOS_ORFAOS.length) {
    const removidos = data.map((d) => d.name);
    const naoRemovidos = ARQUIVOS_ORFAOS.filter((a) => !removidos.includes(a));
    console.log(`\n⚠️  ${naoRemovidos.length} arquivo(s) não foram encontrados (já podem ter sido removidos antes):`);
    naoRemovidos.forEach((a) => console.log(`   - ${a}`));
  }
}

main().catch((erro) => {
  console.error("\n❌ ERRO FATAL:", erro);
  process.exit(1);
});

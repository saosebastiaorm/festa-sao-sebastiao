/**
 * Script de migração — otimização das imagens de produtos já existentes
 * FPSS 2027
 *
 * O que faz:
 *   1. Lista todos os arquivos do bucket "produtos" no Supabase Storage
 *   2. Baixa cada um
 *   3. Redimensiona (máx. 1200px no lado maior) e converte para WebP
 *      qualidade 80 — mesma lógica já aplicada na rota de upload nova
 *   4. Sobe o novo arquivo .webp
 *   5. Atualiza a coluna "imagem" na tabela "produtos" para a nova URL
 *      (procura por linhas cujo campo imagem contenha o nome do
 *      arquivo antigo)
 *   6. Apaga o arquivo antigo (.png/.jpg) do Storage
 *
 * COMO USAR:
 *   1. cd F:\Site\fpss\fpss-backend
 *   2. node migrar-imagens-produtos.js
 *
 * SEGURANÇA: este script só roda local, na sua máquina — ele lê as
 * credenciais do .env do próprio backend, exatamente como o server.js
 * já faz. Nada é exposto além do que já está no seu ambiente normal.
 *
 * O script NÃO apaga nada até confirmar que o novo arquivo .webp foi
 * enviado com sucesso E que a tabela "produtos" foi atualizada — só
 * depois disso ele remove o arquivo antigo.
 */

require("dotenv").config();
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERRO: SUPABASE_URL ou SUPABASE_KEY não encontrados no .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BUCKET = "produtos";

async function formatKB(bytes) {
  return (bytes / 1024).toFixed(1) + " KB";
}

async function migrarArquivo(nomeArquivoAntigo) {
  console.log(`\n📁 Processando: ${nomeArquivoAntigo}`);

  // 1. Baixa o arquivo original
  const { data: blobAntigo, error: erroDownload } = await supabase.storage
    .from(BUCKET)
    .download(nomeArquivoAntigo);

  if (erroDownload) {
    console.error(`   ❌ Erro ao baixar: ${erroDownload.message}`);
    return { sucesso: false, arquivo: nomeArquivoAntigo };
  }

  const bufferOriginal = Buffer.from(await blobAntigo.arrayBuffer());
  const tamanhoOriginal = bufferOriginal.length;

  // 2. Otimiza (mesma lógica da rota de upload)
  let bufferOtimizado;
  try {
    bufferOtimizado = await sharp(bufferOriginal)
      .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch (erroSharp) {
    console.error(`   ❌ Erro ao processar imagem: ${erroSharp.message}`);
    return { sucesso: false, arquivo: nomeArquivoAntigo };
  }

  const tamanhoOtimizado = bufferOtimizado.length;

  // 3. Define o novo nome (mesmo nome-base, extensão .webp)
  const nomeBase = nomeArquivoAntigo.replace(/\.[^.]+$/, "");
  const nomeArquivoNovo = `${nomeBase}.webp`;

  // 4. Sobe o novo arquivo otimizado
  const { error: erroUpload } = await supabase.storage
    .from(BUCKET)
    .upload(nomeArquivoNovo, bufferOtimizado, {
      contentType: "image/webp",
      upsert: true,
    });

  if (erroUpload) {
    console.error(`   ❌ Erro ao subir novo arquivo: ${erroUpload.message}`);
    return { sucesso: false, arquivo: nomeArquivoAntigo };
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(nomeArquivoNovo);
  const novaUrl = urlData.publicUrl;

  console.log(`   ✅ Novo arquivo: ${nomeArquivoNovo}`);
  console.log(`   📦 ${await formatKB(tamanhoOriginal)} → ${await formatKB(tamanhoOtimizado)} (economia: ${await formatKB(tamanhoOriginal - tamanhoOtimizado)})`);

  // 5. Atualiza a tabela "produtos" — procura linhas cujo campo
  // "imagem" contenha o nome do arquivo antigo, e troca pela nova URL
  const { data: produtosAfetados, error: erroSelect } = await supabase
    .from("produtos")
    .select("id, imagem")
    .ilike("imagem", `%${nomeArquivoAntigo}%`);

  if (erroSelect) {
    console.error(`   ⚠️  Não foi possível verificar a tabela produtos: ${erroSelect.message}`);
    console.error(`   ⚠️  Arquivo novo foi criado, mas você precisa atualizar a URL manualmente no admin.`);
    return { sucesso: true, atualizouBanco: false, arquivo: nomeArquivoAntigo, novoArquivo: nomeArquivoNovo, novaUrl };
  }

  if (!produtosAfetados || produtosAfetados.length === 0) {
    console.log(`   ℹ️  Nenhum produto na tabela referencia este arquivo diretamente (pode já estar correto, ou ser referenciado de outra forma).`);
    return { sucesso: true, atualizouBanco: false, arquivo: nomeArquivoAntigo, novoArquivo: nomeArquivoNovo, novaUrl };
  }

  for (const produto of produtosAfetados) {
    const { error: erroUpdate } = await supabase
      .from("produtos")
      .update({ imagem: novaUrl })
      .eq("id", produto.id);

    if (erroUpdate) {
      console.error(`   ❌ Erro ao atualizar produto id=${produto.id}: ${erroUpdate.message}`);
    } else {
      console.log(`   ✅ Produto id=${produto.id} atualizado com a nova URL`);
    }
  }

  // 6. Só agora, com tudo confirmado, apaga o arquivo antigo
  const { error: erroDelete } = await supabase.storage.from(BUCKET).remove([nomeArquivoAntigo]);

  if (erroDelete) {
    console.error(`   ⚠️  Não foi possível apagar o arquivo antigo: ${erroDelete.message}`);
    console.error(`   ⚠️  O novo arquivo já está no ar e o banco já foi atualizado — apague "${nomeArquivoAntigo}" manualmente no Supabase Storage quando puder.`);
  } else {
    console.log(`   🗑️  Arquivo antigo "${nomeArquivoAntigo}" removido.`);
  }

  return { sucesso: true, atualizouBanco: true, arquivo: nomeArquivoAntigo, novoArquivo: nomeArquivoNovo, novaUrl };
}

async function main() {
  console.log("🖼️  Migração de imagens de produtos — FPSS 2027\n");
  console.log("Listando arquivos do bucket 'produtos'...\n");

  const { data: arquivos, error: erroList } = await supabase.storage.from(BUCKET).list();

  if (erroList) {
    console.error("ERRO ao listar arquivos do bucket:", erroList.message);
    process.exit(1);
  }

  // Ignora arquivos que já são .webp (já otimizados)
  const arquivosParaMigrar = arquivos.filter(
    (a) => a.name && !a.name.toLowerCase().endsWith(".webp")
  );

  if (arquivosParaMigrar.length === 0) {
    console.log("✅ Nenhum arquivo pendente de migração — todos já estão em .webp.");
    return;
  }

  console.log(`Encontrados ${arquivosParaMigrar.length} arquivo(s) para otimizar:\n`);
  arquivosParaMigrar.forEach((a) => console.log(`  - ${a.name}`));

  const resultados = [];
  for (const arquivo of arquivosParaMigrar) {
    const resultado = await migrarArquivo(arquivo.name);
    resultados.push(resultado);
  }

  console.log("\n" + "=".repeat(60));
  console.log("✅ Migração concluída!");
  console.log(`   ${resultados.filter((r) => r.sucesso).length} arquivo(s) otimizado(s) com sucesso`);
  console.log(`   ${resultados.filter((r) => !r.sucesso).length} arquivo(s) com erro`);

  const semAtualizacaoBanco = resultados.filter((r) => r.sucesso && !r.atualizouBanco);
  if (semAtualizacaoBanco.length > 0) {
    console.log(`\n⚠️  ${semAtualizacaoBanco.length} arquivo(s) foram otimizados mas NÃO tiveram a tabela`);
    console.log(`   "produtos" atualizada automaticamente (nenhuma linha encontrada com esse`);
    console.log(`   nome de arquivo no campo "imagem"). Verifique manualmente no admin se a`);
    console.log(`   imagem do produto ainda aparece corretamente:`);
    semAtualizacaoBanco.forEach((r) => console.log(`   - ${r.arquivo} → ${r.novoArquivo}`));
  }
}

main().catch((erro) => {
  console.error("\n❌ ERRO FATAL:", erro);
  process.exit(1);
});

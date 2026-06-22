/* =====================================================
   ARQUIVO: src/services/cartelas/upload-cartela-storage.js

   Faz upload do PNG da cartela digital para o Supabase
   Storage, no bucket "cartelas-digitais", e devolve a URL
   pública para salvar em cartelas.pdf_url.

   IMPORTANTE: requer que o bucket "cartelas-digitais" já
   exista no projeto Supabase, configurado como público
   (ou com policy de leitura pública) — ver instruções
   separadas de criação do bucket.
===================================================== */

async function uploadCartelaDigital(supabase, numeroChance1, pngBuffer) {
  const nomeArquivo = `cartela-${numeroChance1.replace(/[^a-zA-Z0-9-]/g, "")}.png`;

  const { error: uploadError } = await supabase.storage
    .from("cartelas-digitais")
    .upload(nomeArquivo, pngBuffer, {
      contentType: "image/png",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Erro ao enviar cartela digital para o Storage: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from("cartelas-digitais").getPublicUrl(nomeArquivo);

  return data.publicUrl;
}

module.exports = {
  uploadCartelaDigital,
};

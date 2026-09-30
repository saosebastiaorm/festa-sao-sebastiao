/* =====================================================
   ARQUIVO: src/services/cartelas/lotes.js

   Lotes/remessas de cartelas (tabela lotes_cartelas). Cada tipo
   (física/digital) tem no máximo UM lote ativo por vez — garantido
   também no banco por um índice único parcial (uq_lotes_cartelas_
   ativo_por_tipo). Preço e disponibilidade das rotas de compra
   passam a vir daqui, não mais de cartelas_config.lote_ativo/
   modo_teste (que ficam só como histórico, sem uso).
===================================================== */

async function buscarLoteAtivo(supabase, tipo) {
  const { data, error } = await supabase
    .from("lotes_cartelas")
    .select("*")
    .eq("tipo", tipo)
    .eq("ativo", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar lote ativo (${tipo}): ${error.message}`);
  }

  return data; // null se nenhum lote desse tipo estiver ativo
}

function valorEmReais(loteCartelas) {
  return Number(loteCartelas.valor_centavos) / 100;
}

module.exports = { buscarLoteAtivo, valorEmReais };

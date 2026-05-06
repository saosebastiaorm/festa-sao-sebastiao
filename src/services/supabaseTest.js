const supabase = require("../config/supabase");

async function testarConexao() {
  const { data, error } = await supabase
    .from("pedidos")
    .select("*")
    .limit(1);

  if (error) {
    console.log("❌ Erro Supabase:", error.message);
  } else {
    console.log("✅ Supabase conectado com sucesso!");
    console.log(data);
  }
}

module.exports = testarConexao;
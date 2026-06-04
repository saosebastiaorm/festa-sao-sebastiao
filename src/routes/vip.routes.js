const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

// Inicializa o Supabase usando as variáveis de ambiente seguras do seu servidor
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ROTA POST: https://api.festasaosebastiao.com.br/api/vip

// Substitua o início do router.post no seu vip.routes.js por isto:
router.post("/", async (req, res) => {
  try {
    const { nome, whatsapp, cidade, bairro, origem } = req.body;

    // Validação robusta: Verifica se os campos existem
    if (!nome || !whatsapp || !cidade || !bairro) {
      return res.status(400).json({
        sucesso: false,
        erro: "Todos os campos são obrigatórios."
      });
    }

    // Só faz o .trim() depois de ter certeza que são textos válidos
    const payload = {
      nome: String(nome).trim(),
      whatsapp: String(whatsapp).trim(),
      cidade: String(cidade).trim(),
      bairro: String(bairro).trim(),
      origem: origem || "VIP"
    };

    // ... resto do seu código de insert do Supabase ...

    // Salva de forma segura por dentro do servidor
    const { data, error } = await supabase
      .from("vip")
      .insert([payload]);

    if (error) {
      console.error("Erro ao inserir no Supabase:", error);
      return res.status(500).json({
        sucesso: false,
        erro: error.message
      });
    }

    // RETORNO CORRIGIDO INTEIRO: Garante a resposta imediata ao site
    return res.status(200).json({
      sucesso: true,
      mensagem: "Cadastro VIP realizado com sucesso!"
    });

  } catch (erro) {
    console.error("Erro interno na rota VIP:", erro);
    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno no servidor."
    });
  }
});

module.exports = router;
const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase"); // Ajuste o caminho se a sua pasta config for diferente

router.post("/enquete", async (req, res) => {
    // Recolhe absolutamente todos os campos enviados pelo HTML
    const {
        nome, whatsapp, aniversario, cep, cidade,
        bairro, rua, endereco_numero, comprou_antes,
        pergunta1, pergunta2, pergunta3, pergunta4
    } = req.body;

    try {
        // Insere diretamente na tabela 'enquetes' que criámos no Supabase
        const { data, error } = await supabase
            .from("enquetes")
            .insert([
                {
                    nome,
                    whatsapp,
                    aniversario,
                    cep,
                    cidade,
                    bairro,
                    rua,
                    endereco_numero,
                    comprou_antes,
                    pergunta1,
                    pergunta2,
                    pergunta3,
                    pergunta4
                }
            ]);

        if (error) {
            console.error("Erro Supabase:", error.message);
            return res.status(400).json({ sucesso: false, mensagem: "Erro ao salvar no banco", erro: error.message });
        }

        return res.json({ sucesso: true, mensagem: "Enquete salva com sucesso!" });

    } catch (error) {
        console.error("Erro Servidor:", error.message);
        return res.status(500).json({ sucesso: false, mensagem: "Erro interno no servidor de enquetes" });
    }
});

module.exports = router;
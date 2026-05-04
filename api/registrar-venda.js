const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      const dados = req.body;
      const { data, error } = await supabase
        .from('vendas_festa')
        .insert([
          { 
            nome: dados.nome, 
            sobrenome: dados.sobrenome,
            cpf: dados.cpf, 
            quantidade: parseInt(dados.quantidade),
            horario_retirada: dados.horario_retirada,
            valor_total: parseFloat(dados.valor_total.replace(',', '.')),
            status: 'pendente' 
          }
        ]);

      if (error) throw error;
      return res.status(200).json({ status: 'sucesso', data });
    } catch (err) {
      return res.status(500).json({ status: 'erro', message: err.message });
    }
  } else {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
};

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  try {
    const dados = req.body;

    // Limpa o valor para garantir que seja um número puro
    const valorLimpo = dados.valor_total.replace('.', '').replace(',', '.');

    const { data, error } = await supabase
      .from('vendas_festa')
      .insert([
        { 
          nome: dados.nome, 
          sobrenome: dados.sobrenome,
          cpf: dados.cpf, 
          quantidade: parseInt(dados.quantidade),
          horario_retirada: dados.horario_retirada,
          valor_total: parseFloat(valorLimpo),
          status: 'pendente' 
        }
      ]);

    if (error) {
      console.error('Erro Supabase:', error);
      return res.status(400).json({ erro: error.message });
    }

    return res.status(200).json({ mensagem: 'Venda registrada!', data });
  } catch (error) {
    console.error('Erro Interno:', error);
    return res.status(500).json({ erro: 'Falha interna no servidor' });
  }
}

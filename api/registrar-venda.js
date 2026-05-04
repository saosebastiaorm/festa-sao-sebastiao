import { createClient } from '@supabase/supabase-js'

// A Vercel vai ler as variáveis que você cadastrou lá no painel (URL e KEY)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

export default async function handler(req, res) {
  // Só aceita pedidos do tipo POST (envio de formulário)
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  try {
    const dados = req.body;

    // Tenta inserir os dados na tabela 'vendas_festa'
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

    return res.status(200).json({ mensagem: 'Venda registrada!', data });
  } catch (error) {
    return res.status(400).json({ erro: error.message });
  }
} 

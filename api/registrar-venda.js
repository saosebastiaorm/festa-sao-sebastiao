export default async function handler(req, res) {
  // 1. Só aceita se for o site enviando dados (POST)
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const { nome, sobrenome, cpf, quantidade, horario_retirada, valor_total } = req.body;

  // 2. Prepara os dados para o Supabase
  const url = `${process.env.SUPABASE_URL}/rest/v1/vendas_festa`;
  const valorLimpo = valor_total.replace('.', '').replace(',', '.');

  try {
    // 3. Envia direto para a "porta" do banco de dados
    const resposta = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        nome,
        sobrenome,
        cpf,
        quantidade: parseInt(quantidade),
        horario_retirada,
        valor_total: parseFloat(valorLimpo),
        status: 'pendente'
      })
    });

    const resultado = await resposta.json();

    if (!resposta.ok) {
      return res.status(resposta.status).json({ erro: resultado });
    }

    return res.status(200).json({ mensagem: 'Venda salva!', resultado });
  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Apenas POST permitido' });
  }

  const { nome, sobrenome, cpf, quantidade, horario_retirada, valor_total } = req.body;

  // URL direta da API do seu Supabase
  const url = `${process.env.SUPABASE_URL}/rest/v1/vendas_festa`;

  try {
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
        valor_total: parseFloat(valor_total.replace(',', '.')),
        status: 'pendente'
      })
    });

    if (!resposta.ok) {
      const erroTexto = await resposta.text();
      return res.status(resposta.status).json({ erro: erroTexto });
    }

    const resultado = await resposta.json();
    return res.status(200).json({ mensagem: 'Sucesso!', resultado });
  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}

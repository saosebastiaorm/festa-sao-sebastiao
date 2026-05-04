export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Apenas POST' });
  }

  const { nome, sobrenome, cpf, quantidade, horario_reexport default async function handler(req, res) {
  // Ignora se não for POST
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const { nome, sobrenome, cpf, quantidade, horario_retirada, valor_total } = req.body;

  // Conversão segura do valor para número
  const valorLimpo = valor_total.toString().replace('.', '').replace(',', '.');

  try {
    // Fala direto com o Supabase via URL (sem biblioteca)
    const resposta = await fetch(`${process.env.SUPABASE_URL}/rest/v1/vendas_festa`, {
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

    return res.status(200).json({ mensagem: 'Sucesso!', resultado });
  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}tirada, valor_total } = req.body;

  // Monta o comando para o Supabase via REST API (sem precisar de biblioteca)
  const url = `${process.env.SUPABASE_URL}/rest/v1/vendas_festa`;
  const valorLimpo = valor_total.replace('.', '').replace(',', '.');

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
        valor_total: parseFloat(valorLimpo),
        status: 'pendente'
      })
    });

    const resultado = await resposta.json();

    if (!resposta.ok) {
      return res.status(resposta.status).json({ erro: resultado });
    }

    return res.status(200).json({ mensagem: 'Venda registrada!', resultado });
  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}

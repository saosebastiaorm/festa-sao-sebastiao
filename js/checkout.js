document.getElementById('formCheckout').onsubmit = async function(e) {
    e.preventDefault();
    
    const btn = e.target.querySelector('button');
    btn.innerText = "Processando... ⏳";
    btn.disabled = true;

    // Pega os dados do formulário
    const formData = new FormData(e.target);
    const dados = {
        nome: formData.get('nome'),
        sobrenome: formData.get('sobrenome'),
        cpf: formData.get('cpf'),
        quantidade: formData.get('quantidade'),
        horario_retirada: formData.get('horario_retirada'),
        // No js/checkout.js, mude temporariamente para:
        valor_total: "60.00", //valor_total: document.getElementById('valorTotal').innerText.replace('R$ ', ''),
        status: 'pendente'
    };

    try {
        // Envia para a API que vamos criar na Vercel
        const resposta = await fetch('/api/registrar-venda', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });

        if (resposta.ok) {
            alert('Pedido registrado! Gerando seu PIX Sicredi...');
            // Aqui depois vamos redirecionar para a tela do QR Code
        } else {
            alert('Erro ao salvar pedido. Tente novamente.');
        }
    } catch (erro) {
        console.error(erro);
        alert('Falha na conexão.');
    } finally {
        btn.innerText = "GERAR PIX AGORA 🚀";
        btn.disabled = false;
    }
};

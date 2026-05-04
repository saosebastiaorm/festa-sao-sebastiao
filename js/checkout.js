document.getElementById('formCheckout').onsubmit = async function(e) {
    e.preventDefault();
    
    const btn = e.target.querySelector('button');
    const textoOriginal = btn.innerText;
    btn.innerText = "Processando... ⏳";
    btn.disabled = true;

    // Pega os dados dos campos
    const formData = new FormData(e.target);
    const dados = {
        nome: formData.get('nome'),
        sobrenome: formData.get('sobrenome'),
        cpf: formData.get('cpf'),
        quantidade: formData.get('quantidade'),
        horario_retirada: formData.get('horario_retirada'),
        valor_total: document.getElementById('valorTotal').innerText.replace('R$ ', '')
    };

    try {
        // Envia para a sua API na Vercel
        const resposta = await fetch('/api/registrar-venda', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });

        const resultado = await resposta.json();

        if (resposta.ok) {
            alert('✅ SUCESSO! Pedido salvo no banco de dados.');
            // Aqui depois vamos colocar o link para o QR Code do PIX
        } else {
            console.error('Erro da API:', resultado);
            alert('❌ Erro na API: ' + (resultado.erro || 'Falha ao salvar'));
        }
    } catch (erro) {
        console.error('Erro de rede:', erro);
        alert('🌐 Falha de conexão. Verifique se a internet está ok.');
    } finally {
        btn.innerText = textoOriginal;
        btn.disabled = false;
    }
};

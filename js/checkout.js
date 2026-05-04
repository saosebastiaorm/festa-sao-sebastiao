document.getElementById('formCheckout').onsubmit = async function(e) {
    e.preventDefault();
    
    const btn = e.target.querySelector('button');
    btn.innerText = "Processando... ⏳";
    btn.disabled = true;

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
        const resposta = await fetch('/api/registrar-venda', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });

        const resultado = await resposta.json();

        if (resposta.ok) {
            alert('✅ SUCESSO! O Marcos Belgamazzi agora tem uma venda no banco!');
        } else {
            alert('❌ Erro na API: ' + JSON.stringify(resultado.erro));
        }
    } catch (erro) {
        alert('🌐 Erro de conexão: ' + erro.message);
    } finally {
        btn.innerText = "GERAR PIX AGORA 🚀";
        btn.disabled = false;
    }
};

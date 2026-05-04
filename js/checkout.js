document.getElementById('formCheckout').onsubmit = async function(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.innerText = "Salvando no Banco... ⏳";
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
        const res = await fetch('/api/registrar-venda', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });

        const resultado = await res.json();

        if (res.ok) {
            alert('✅ SUCESSO! A venda apareceu no Supabase.');
        } else {
            console.error('Detalhe do erro:', resultado);
            alert('❌ Erro na API: ' + JSON.stringify(resultado.erro));
        }
    } catch (err) {
        alert('🌐 Erro de conexão com o servidor.');
    } finally {
        btn.innerText = "GERAR PIX AGORA 🚀";
        btn.disabled = false;
    }
};

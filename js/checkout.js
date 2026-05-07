document.getElementById('formCheckout').onsubmit = async function(e) {
    e.preventDefault();

    const btn = e.target.querySelector('button');
    btn.innerText = "Gerando PIX... ⏳";
    btn.disabled = true;

    const formData = new FormData(e.target);

    const dados = {
        nome: formData.get('nome') + " " + formData.get('sobrenome'),
        telefone: "não informado", // depois podemos melhorar
        quantidade: parseInt(formData.get('quantidade'))
    };

    try {

        const res = await fetch('http://localhost:3000/criar-pix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });

        const resultado = await res.json();

        if (res.ok) {

            alert(
                "✅ PIX GERADO!\n\n" +
                "Valor: R$ " + resultado.valor + "\n" +
                "TXID: " + resultado.txid
            );

        } else {
            console.error('Erro:', resultado);
            alert('❌ Erro ao gerar Pix');
        }

    } catch (err) {
        alert('🌐 Erro de conexão com o servidor.');
    } finally {
        btn.innerText = "GERAR PIX AGORA 🚀";
        btn.disabled = false;
    }
};

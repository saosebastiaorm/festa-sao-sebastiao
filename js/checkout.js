document.getElementById('formCheckout').onsubmit = async function(e) {
    e.preventDefault();

    const btn = e.target.querySelector('button');
    btn.innerText = "Gerando PIX... ⏳";
    btn.disabled = true;

    const formData = new FormData(e.target);

    const dados = {
        nome: formData.get('nome'),
        sobrenome: formData.get('sobrenome'),
        cpf: formData.get('cpf'),
        telefone: "não informado",
        quantidade: parseInt(formData.get('quantidade')),
        horario_retirada: formData.get('horario_retirada')
    };

    try {

        const res = await fetch('http://localhost:3000/criar-pix', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(dados)
        });

        const resultado = await res.json();

        console.log("PIX:", resultado);

        if (res.ok && resultado.sucesso) {

            localStorage.setItem("pixData", JSON.stringify(resultado));

            window.location.href = "/venda/finalizar-compra.html";

        } else {

            console.error("Erro:", resultado);

            alert("❌ Erro ao gerar PIX: " + (resultado.erro || "Erro desconhecido"));
        }

    } catch (err) {

        console.error("Erro conexão:", err);

        alert("🌐 Erro de conexão com o servidor.");

    } finally {

        btn.innerText = "GERAR PIX AGORA 🚀";
        btn.disabled = false;
    }
};
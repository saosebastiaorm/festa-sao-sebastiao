document.getElementById("formCheckout").onsubmit = async function (e) {
    e.preventDefault();

    const btn = e.target.querySelector("button");
    btn.innerText = "Gerando PIX... ⏳";
    btn.disabled = true;

    const formData = new FormData(e.target);

    const dados = {
        nome: formData.get("nome")?.trim(),
        sobrenome: formData.get("sobrenome")?.trim(),
        cpf: formData.get("cpf")?.trim(),
        telefone: formData.get("telefone")?.trim() || "não informado",
        email: formData.get("email")?.trim() || null,
        quantidade: parseInt(formData.get("quantidade")),
        horario_retirada: formData.get("horario_retirada")
    };

    if (!dados.nome || !dados.cpf || !dados.quantidade || dados.quantidade < 1) {
        alert("❌ Preencha corretamente os campos obrigatórios.");
        btn.innerText = "GERAR PIX AGORA 🚀";
        btn.disabled = false;
        return;
    }

    try {

        const res = await fetch("https://fpss-backend.onrender.com/criar-pix", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(dados)
        });

        const resultado = await res.json();

        console.log("PIX:", resultado);

        if (res.ok && resultado.sucesso) {

            localStorage.setItem("pixData", JSON.stringify({
                payment_id: resultado.payment_id,
                codigo_pedido: resultado.codigo_pedido,
                produto_tipo: resultado.produto_tipo,

                total: resultado.total,

                qr_code: resultado.qr_code,
                qr_code_base64: resultado.qr_code_base64,

                qr_code_retirada: resultado.qr_code_retirada,
                token_retirada: resultado.token_retirada
            }));

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
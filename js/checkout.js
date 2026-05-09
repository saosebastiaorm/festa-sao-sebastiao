document.getElementById("formCheckout").onsubmit = async function(e) {
  e.preventDefault();

  const btn = e.target.querySelector("button");

  btn.innerText = "Gerando PIX... ⏳";
  btn.disabled = true;

  const formData = new FormData(e.target);

  const dados = {
    nome: formData.get("nome")?.trim(),
    sobrenome: formData.get("sobrenome")?.trim(),
    cpf: formData.get("cpf")?.replace(/\D/g, ""),
    telefone: formData.get("telefone")?.replace(/\D/g, ""),
    email: formData.get("email")?.trim(),
    quantidade: parseInt(formData.get("quantidade")) || 1,
    horario_retirada: formData.get("horario_retirada")
  };

  /* =========================================
     VALIDAÇÃO
  ========================================= */
  if (
    !dados.nome ||
    !dados.sobrenome ||
    !dados.cpf ||
    dados.cpf.length !== 11 ||
    !dados.quantidade
  ) {

    alert("❌ Preencha corretamente nome, sobrenome, CPF e quantidade.");

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

    if (!res.ok || !resultado.sucesso) {

      alert("❌ " + (resultado.erro || "Erro ao gerar PIX"));

      btn.innerText = "GERAR PIX AGORA 🚀";
      btn.disabled = false;

      return;
    }

    /* =========================================
       SALVAR DADOS COMPLETOS
    ========================================= */
    const pixData = {
      ...resultado,

      nome: dados.nome,
      sobrenome: dados.sobrenome,
      cpf: dados.cpf,
      telefone: dados.telefone,
      email: dados.email,
      quantidade: dados.quantidade,
      horario_retirada: dados.horario_retirada,

      total:
        resultado.total ||
        resultado.valor ||
        resultado.valor_total ||
        0
    };

    localStorage.setItem(
      "pixData",
      JSON.stringify(pixData)
    );

    window.location.href = "/venda/finalizar-compra.html";

  } catch (err) {

    console.error("Erro conexão:", err);

    alert("🌐 Erro de conexão com o servidor.");

  } finally {

    btn.innerText = "GERAR PIX AGORA 🚀";
    btn.disabled = false;
  }
};
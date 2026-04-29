/* =====================================================
FPSS - ENQUETE JS (ALTA CONVERSÃO)
===================================================== */

/* 🔗 URL DO SEU APPS SCRIPT */
const URL_SCRIPT = "https://script.google.com/macros/s/AKfycbzc4p873RcAhbAegYAC1Wc1esCyhKsI8pNPhvfCYavGPBAHES3ppfeduiKdVE08IUd_/exec";

/* =====================================================
MÁSCARA WHATSAPP
===================================================== */
const whatsapp = document.getElementById("whatsapp");

whatsapp.addEventListener("input", function (e) {
  let v = e.target.value.replace(/\D/g, "").slice(0, 11);

  if (v.length > 10) {
    v = v.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, "($1) $2-$3");
  } else if (v.length > 6) {
    v = v.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, "($1) $2-$3");
  } else if (v.length > 2) {
    v = v.replace(/^(\d{2})(\d*)/, "($1) $2");
  } else {
    v = v.replace(/^(\d*)/, "($1");
  }

  e.target.value = v;
});

/* =====================================================
MÁSCARA CEP
===================================================== */
const cep = document.getElementById("cep");

cep.addEventListener("input", function (e) {
  let v = e.target.value.replace(/\D/g, "").slice(0, 8);

  if (v.length > 5) {
    v = v.replace(/^(\d{5})(\d+)/, "$1-$2");
  }

  e.target.value = v;
});

/* =====================================================
BUSCAR ENDEREÇO VIA CEP (VIACEP)
===================================================== */
cep.addEventListener("blur", async function () {
  let valor = this.value.replace(/\D/g, "");

  if (valor.length !== 8) return;

  try {
    const res = await fetch(`https://viacep.com.br/ws/${valor}/json/`);
    const data = await res.json();

    if (!data.erro) {
      document.getElementById("cidade").value = data.localidade || "";
      document.getElementById("bairro").value = data.bairro || "";
      document.getElementById("rua").value = data.logradouro || "";
    }
  } catch (err) {
    console.log("Erro CEP:", err);
  }
});

/* =====================================================
VALIDAÇÃO WHATSAPP
===================================================== */
function validarWhatsApp(numero) {
  const digitos = numero.replace(/\D/g, "");
  return digitos.length === 11;
}

/* =====================================================
ENVIO DO FORMULÁRIO
===================================================== */
const form = document.getElementById("formEnquete");
const msg = document.getElementById("msg");

form.addEventListener("submit", async function (e) {
  e.preventDefault();

  const whatsappValue = whatsapp.value;

  /* VALIDAÇÃO */
  if (!validarWhatsApp(whatsappValue)) {
    msg.style.color = "#ff1f1f";
    msg.innerHTML = "❌ Informe um WhatsApp válido com DDD.";
    whatsapp.focus();
    return;
  }

  msg.style.color = "#333";
  msg.innerHTML = "⏳ Enviando...";

  const dados = new FormData(form);

  try {
    await fetch(URL_SCRIPT, {
      method: "POST",
      body: dados,
    });

    /* SUCESSO */
    msg.style.color = "#1fae42";
    msg.innerHTML = "✅ Cadastro realizado com sucesso!";

    form.reset();

    /* REDIRECIONA */
    setTimeout(() => {
      window.location.href = "obrigado.html";
    }, 1200);

  } catch (error) {
    console.log(error);

    msg.style.color = "#ff1f1f";
    msg.innerHTML = "❌ Erro ao enviar. Tente novamente.";
  }
});

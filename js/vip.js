const URL_SCRIPT = "https://script.google.com/macros/s/AKfycbzc4p873RcAhbAegYAC1Wc1esCyhKsI8pNPhvfCYavGPBAHES3ppfeduiKdVE08IUd_/exec";

document.addEventListener("DOMContentLoaded", function(){

  const form = document.getElementById("formVIP");
  const msg = document.getElementById("msgVIP");

  if(!form) return;

  form.addEventListener("submit", function(e){

    e.preventDefault();

    const dados = new FormData(form);

    // GARANTIA DE ORIGEM (SEGURANÇA DUPLA)
    dados.append("origem", "VIP");

    msg.innerHTML = "⏳ Enviando...";

    fetch(URL_SCRIPT, {
      method: "POST",
      body: dados
    })
    .then(r => r.text())
    .then(() => {
      msg.innerHTML = "✅ Entrou no VIP com sucesso!";
      form.reset();
    })
    .catch(() => {
      msg.innerHTML = "❌ Erro ao enviar.";
    });

  });

});

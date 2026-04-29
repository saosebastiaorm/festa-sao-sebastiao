const URL_SCRIPT = "https://script.google.com/macros/s/AKfycbzc4p873RcAhbAegYAC1Wc1esCyhKsI8pNPhvfCYavGPBAHES3ppfeduiKdVE08IUd_/exec";

document.getElementById("formVIP").addEventListener("submit", function(e){

  e.preventDefault();

  const form = this;
  const dados = new FormData(form);

  const msg = document.getElementById("msgVIP");
  msg.style.color = "#333";
  msg.innerHTML = "⏳ Enviando...";

  fetch(URL_SCRIPT, {
    method: "POST",
    body: dados
  })
  .then(r => r.text())
  .then(() => {
    msg.style.color = "#1fae42";
    msg.innerHTML = "✅ Cadastro realizado com sucesso!";
    form.reset();
  })
  .catch(() => {
    msg.style.color = "#ff1f1f";
    msg.innerHTML = "❌ Erro ao enviar. Tente novamente.";
  });

});

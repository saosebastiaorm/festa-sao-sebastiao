const URL_SCRIPT = "https://script.google.com/macros/s/AKfycbzc4p873RcAhbAegYAC1Wc1esCyhKsI8pNPhvfCYavGPBAHES3ppfeduiKdVE08IUd_/exec";

document.getElementById("formVIP").addEventListener("submit", function(e){

  e.preventDefault();

  const form = this;
  const dados = new FormData(form);

  const msg = document.getElementById("msgVIP");

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

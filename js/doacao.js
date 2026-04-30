const URL_SCRIPT = "https://script.google.com/macros/s/AKfycbzc4p873RcAhbAegYAC1Wc1esCyhKsI8pNPhvfCYavGPBAHES3ppfeduiKdVE08IUd_/exec";

document.addEventListener("DOMContentLoaded", function(){

  const form = document.getElementById("formDoacao");
  const msg = document.getElementById("msg");

  if(!form) return;

  form.addEventListener("submit", async function(e){
    e.preventDefault();

    msg.style.color = "#333";
    msg.innerHTML = "⏳ Enviando...";

    const dados = new FormData(form);
    dados.set("origem","DOACAO");

    try{

      await fetch(URL_SCRIPT,{
        method:"POST",
        body:dados
      });

      msg.style.color = "green";
      msg.innerHTML = "✅ Doação enviada com sucesso!";

      form.reset();

    }catch(err){

      console.log(err);

      msg.style.color = "red";
      msg.innerHTML = "❌ Erro ao enviar. Tente novamente.";

    }

  });

});

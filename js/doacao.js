const URL_SCRIPT = "COLE_SEU_SCRIPT_AQUI";

const form = document.getElementById("formDoacao");
const msg = document.getElementById("msgDoacao");

const tipo = document.getElementById("tipoDoacao");
const boxValor = document.getElementById("boxValor");

/* MOSTRA VALOR SÓ PARA DINHEIRO */
tipo.addEventListener("change", function(){

  if(this.value === "Dinheiro" || this.value === "Patrocínio"){
    boxValor.style.display = "block";
  } else {
    boxValor.style.display = "none";
  }

});

/* ENVIO */
form.addEventListener("submit", async function(e){

  e.preventDefault();

  msg.innerHTML = "⏳ Enviando...";

  const dados = new FormData(form);

  try{

    await fetch(URL_SCRIPT,{
      method:"POST",
      body:dados
    });

    msg.innerHTML = "✅ Doação registrada com sucesso!";
    form.reset();

  }catch{
    msg.innerHTML = "❌ Erro ao enviar.";
  }

});

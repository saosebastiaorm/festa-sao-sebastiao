const URL_SCRIPT = "SUA_URL_AQUI";

document.addEventListener("DOMContentLoaded", function(){

  const form = document.getElementById("formDoacao");
  const msg = document.getElementById("msg");
  const tipo = document.getElementById("tipoDoacao");
  const campoComprovante = document.getElementById("campoComprovante");
  const inputFile = document.getElementById("comprovante");

  /* MOSTRAR COMPROVANTE */
  tipo.addEventListener("change", function(){
    if(this.value === "Dinheiro"){
      campoComprovante.style.display = "block";
    } else {
      campoComprovante.style.display = "none";
    }
  });

  /* SUBMIT */
  form.addEventListener("submit", async function(e){
    e.preventDefault();

    msg.innerHTML = "⏳ Enviando...";

    const dados = new FormData(form);
    dados.set("origem","DOACAO");

    // =========================
    // CONVERTE ARQUIVO EM BASE64
    // =========================
    if(inputFile.files.length > 0){

      const file = inputFile.files[0];

      const base64 = await toBase64(file);

      dados.append("arquivo", base64);
      dados.append("nome_arquivo", file.name);
    }

    try{

      await fetch(URL_SCRIPT,{
        method:"POST",
        body:dados
      });

      msg.innerHTML = "✅ Doação enviada com sucesso!";
      form.reset();

    }catch(err){

      msg.innerHTML = "❌ Erro ao enviar.";

    }

  });

});

/* CONVERTER */
function toBase64(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

const URL_SCRIPT = "https://script.google.com/macros/s/AKfycbzc4p873RcAhbAegYAC1Wc1esCyhKsI8pNPhvfCYavGPBAHES3ppfeduiKdVE08IUd_/exec";

document.addEventListener("DOMContentLoaded", function () {

const form = document.getElementById("formEnquete");
const msg = document.getElementById("msg");

const whatsapp = document.getElementById("whatsapp");
const cep = document.getElementById("cep");

/* =========================
VALIDAÇÃO WHATSAPP
========================= */
function validarWhatsApp(numero){
  return (numero || "").replace(/\D/g,"").length === 11;
}

/* =========================
CEP MÁSCARA + BUSCA
========================= */
if (cep) {

  cep.addEventListener("input", function(){
    let v = this.value.replace(/\D/g,"").slice(0,8);
    if(v.length > 5) v = v.replace(/^(\d{5})(\d+)/,"$1-$2");
    this.value = v;
  });

  cep.addEventListener("blur", async function(){
    let v = this.value.replace(/\D/g,"");
    if(v.length !== 8) return;

    try {
      const res = await fetch(`https://viacep.com.br/ws/${v}/json/`);
      const data = await res.json();

      if(!data.erro){
        document.getElementById("cidade").value = data.localidade || "";
        document.getElementById("bairro").value = data.bairro || "";
        document.getElementById("rua").value = data.logradouro || "";
      }
    } catch(e){}
  });

}

/* =========================
SUBMIT
========================= */
form.addEventListener("submit", async function(e){
  e.preventDefault();

  const whatsappValue = (whatsapp?.value || "").trim();

  if(!validarWhatsApp(whatsappValue)){
    msg.style.color = "red";
    msg.innerHTML = "❌ WhatsApp inválido com DDD.";
    return;
  }

  msg.style.color = "#333";
  msg.innerHTML = "⏳ Enviando...";

  const dados = new FormData(form);
  dados.set("origem","ENQUETE");

  try{

    await fetch(URL_SCRIPT,{
      method:"POST",
      body:dados
    });

    msg.style.color = "green";
    msg.innerHTML = "✅ Enviado com sucesso!";

    form.reset();

    setTimeout(()=>{
      window.location.href = "obrigado.html";
    },1200);

  }catch(err){
    msg.style.color="red";
    msg.innerHTML="❌ Erro ao enviar.";
  }

});

});

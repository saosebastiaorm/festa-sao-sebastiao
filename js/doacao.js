const URL_SCRIPT = "https://script.google.com/macros/s/AKfycbzc4p873RcAhbAegYAC1Wc1esCyhKsI8pNPhvfCYavGPBAHES3ppfeduiKdVE08IUd_/exec";

document.addEventListener("DOMContentLoaded", function(){

  const form = document.getElementById("formDoacao");
  const msg = document.getElementById("msg");
  const whatsapp = document.querySelector('input[name="whatsapp"]');

  if(!form) return;

  /* =========================
  MÁSCARA WHATSAPP
  ========================= */
  whatsapp.addEventListener("input", function(){

    let v = this.value.replace(/\D/g,"").slice(0,11);

    if(v.length > 10){
      v = v.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, "($1) $2-$3");
    }else if(v.length > 6){
      v = v.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, "($1) $2-$3");
    }else if(v.length > 2){
      v = v.replace(/^(\d{2})(\d*)/, "($1) $2");
    }else{
      v = v.replace(/^(\d*)/, "($1");
    }

    this.value = v;

  });

  /* =========================
  VALIDAÇÃO WHATSAPP
  ========================= */
  function validarWhats(numero){

    const n = numero.replace(/\D/g,"");

    // 11 dígitos
    if(n.length !== 11) return false;

    // precisa começar com DDD válido (11 a 99)
    const ddd = parseInt(n.substring(0,2));
    if(ddd < 11 || ddd > 99) return false;

    // celular precisa ter 9 depois do DDD
    if(n[2] !== "9") return false;

    // evita número fake (11111111111)
    if(/^(\d)\1+$/.test(n)) return false;

    return true;
  }

  /* =========================
  SUBMIT
  ========================= */
  form.addEventListener("submit", async function(e){
    e.preventDefault();

    const numero = whatsapp.value;

    if(!validarWhats(numero)){
      msg.style.color = "red";
      msg.innerHTML = "❌ WhatsApp inválido. Use DDD + número (ex: 69 98438-4210)";
      whatsapp.focus();
      return;
    }

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
      msg.innerHTML = "❌ Erro ao enviar.";

    }

  });

});

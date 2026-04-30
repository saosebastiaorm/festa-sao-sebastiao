const URL_SCRIPT = "COLE_SEU_SCRIPT_AQUI";
const PIX_CHAVE = "69999005245"; // sua chave

const form = document.getElementById("formDoacao");
const msg = document.getElementById("msg");

form.addEventListener("submit", async function(e){

  e.preventDefault();

  const dados = new FormData(form);
  dados.set("origem","DOACAO");

  const valor = dados.get("valor") || "0";

  /* =========================
  GERAR PIX (simples funcional)
  ========================= */
  const pix =
`00020126580014BR.GOV.BCB.PIX0136${PIX_CHAVE}520400005303986540${valor}5802BR5925FPSS DOACAO6009BRASILIA62070503***6304`;

  document.getElementById("pixCode").value = pix;

  document.getElementById("qrPix").src =
  "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + pix;

  document.getElementById("pixBox").classList.remove("hidden");

  msg.innerHTML = "✅ PIX gerado! Faça o pagamento.";

  /* SALVA NA PLANILHA */
  try{
    await fetch(URL_SCRIPT,{
      method:"POST",
      body:dados
    });
  }catch(e){
    console.log(e);
  }

});

function copiarPix(){
  const pix = document.getElementById("pixCode");
  pix.select();
  document.execCommand("copy");
  alert("PIX copiado!");
}

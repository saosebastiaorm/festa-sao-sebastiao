(function(){

/* =====================================================
   FPSS MASTER
   FORMULÁRIOS OFICIAIS
===================================================== */

/* =========================
   ELEMENTOS
========================= */
const campoQtd = document.getElementById("quantidadePedido");
const campoNome = document.getElementById("nomeCliente");
const campoTelefone = document.getElementById("telefoneCliente");
const campoHorario = document.getElementById("horarioRetirada");
const boxTotal = document.getElementById("valorTotal");

/* =========================
   CONFIGURAÇÃO
========================= */
const PRECO = 60;
const PIX_CHAVE = "6999900-5245"; // <-- ALTERE AQUI

/* =========================
   FORMATA MOEDA
========================= */
function moeda(v){
return "R$ " + v.toFixed(2).replace(".",",");
}

/* =========================
   ATUALIZA TOTAL
========================= */
function atualizarTotal(){

if(!campoQtd || !boxTotal) return;

let qtd = parseInt(campoQtd.value);

if(isNaN(qtd) || qtd < 1){
qtd = 1;
campoQtd.value = 1;
}

const total = qtd * PRECO;
boxTotal.textContent = moeda(total);

}

/* =========================
   EVENTO QUANTIDADE
========================= */
if(campoQtd){
campoQtd.addEventListener("input",atualizarTotal);
atualizarTotal();
}

/* =========================
   LIMPAR TELEFONE
========================= */
function limparNumero(txt){
return txt.replace(/\D/g,"");
}

/* =========================
   VALIDA HORÁRIO
========================= */
function horarioValido(h){

if(!h) return false;

return h >= "09:00" && h <= "16:00";

}

/* =========================
   WHATSAPP
========================= */
window.enviarPedidoWhats = function(){

const nome = campoNome ? campoNome.value.trim() : "";
const telefone = campoTelefone ? campoTelefone.value.trim() : "";
const horario = campoHorario ? campoHorario.value.trim() : "";

let qtd = campoQtd ? parseInt(campoQtd.value) : 1;

if(isNaN(qtd) || qtd < 1){
qtd = 1;
}

/* VALIDACOES */
if(nome === ""){
alert("Informe seu nome.");
if(campoNome) campoNome.focus();
return;
}

if(telefone === ""){
alert("Informe seu telefone.");
if(campoTelefone) campoTelefone.focus();
return;
}

if(!horarioValido(horario)){
alert("Horário inválido. Escolha entre 09:00 e 16:00.");
if(campoHorario) campoHorario.focus();
return;
}

/* TOTAL */
const total = qtd * PRECO;

/* MENSAGEM WHATSAPP */
const msg =
"🔥 PEDIDO CHURRASCO FPSS%0A%0A" +
"👤 Nome: " + nome + "%0A" +
"📞 Telefone: " + telefone + "%0A" +
"🍖 Quantidade: " + qtd + "%0A" +
"⏰ Retirada: " + horario + "%0A%0A" +
"💳 PIX: " + PIX_CHAVE + "%0A%0A" +
"💰 Total: " + moeda(total) + "%0A%0A" +
"📎 Após pagamento, envie o comprovante aqui no WhatsApp.";

window.open(
"https://wa.me/556981102306?text=" + msg,
"_blank"
);

};

/* =========================
   MÁSCARA TELEFONE
========================= */
if(campoTelefone){

campoTelefone.addEventListener("input",function(){

let v = limparNumero(this.value).slice(0,11);

if(v.length > 10){
v = v.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, "($1) $2-$3");
}else if(v.length > 6){
v = v.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, "($1) $2-$3");
}else if(v.length > 2){
v = v.replace(/^(\d{2})(\d{0,5})/, "($1) $2");
}else{
v = v.replace(/^(\d*)/, "($1");
}

this.value = v;

});

}

})();

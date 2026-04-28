/* =====================================================
   FPSS MASTER
   ARQUIVO: /js/forms.js
   FORMULÁRIOS OFICIAIS
===================================================== */

(function(){

/* =====================================================
   CHURRASCO
===================================================== */

const campoQtd = document.getElementById("quantidadePedido");
const campoNome = document.getElementById("nomeCliente");
const campoTelefone = document.getElementById("telefoneCliente");
const campoHorario = document.getElementById("horarioRetirada");
const boxTotal = document.getElementById("valorTotal");

const PRECO = 60;

/* =========================
   FORMATA VALOR
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
   ENVIAR WHATSAPP
========================= */
window.enviarPedidoWhats = function(){

const nome = campoNome ? campoNome.value.trim() : "";
const telefone = campoTelefone ? campoTelefone.value.trim() : "";
const horario = campoHorario ? campoHorario.value.trim() : "";

let qtd = campoQtd ? parseInt(campoQtd.value) : 1;

if(isNaN(qtd) || qtd < 1){
qtd = 1;
}

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

const total = qtd * PRECO;

const msg =
"Olá André! Pedido de Churrasco FPSS:%0A%0A" +
"Nome: " + nome + "%0A" +
"Telefone: " + telefone + "%0A" +
"Quantidade: " + qtd + "%0A" +
"Horário retirada: " + (horario || "Não informado") + "%0A" +
"Valor Total: " + moeda(total) + "%0A%0A" +
"Quero confirmar meu pedido.";

window.open(
"https://wa.me/556981102306?text=" + msg,
"_blank"
);

};

/* =====================================================
   MÁSCARA TELEFONE (opcional)
===================================================== */

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

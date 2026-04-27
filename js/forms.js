/* ==================================================
ARQUIVO: js/forms.js
FORMULÁRIOS FPSS - WHATSAPP
================================================== */

/* ==========================================
PEDIDO CHURRASCO
========================================== */
function enviarPedidoWhats(){

const nome =
document.getElementById("nomeCliente").value.trim();

const telefone =
document.getElementById("telefoneCliente").value.trim();

const quantidade =
document.getElementById("quantidadePedido").value;

const horario =
document.getElementById("horarioRetirada").value;

if(nome === "" || telefone === ""){

alert("Preencha nome e telefone.");
return;

}

const total = Number(quantidade) * 60;

const msg =
`Olá André! Pedido de Churrasco FPSS:

Nome: ${nome}
Telefone: ${telefone}
Quantidade: ${quantidade}
Horário retirada: ${horario}
Valor Total: R$ ${total},00

Pagamento via Pix realizado.`;

const url =
"https://wa.me/556981102306?text=" +
encodeURIComponent(msg);

window.open(url,"_blank");

}

/* ==========================================
ATUALIZA TOTAL AUTOMÁTICO
========================================== */
const campoQtd =
document.getElementById("quantidadePedido");

if(campoQtd){

campoQtd.addEventListener("input", function(){

const qtd = Number(this.value) || 1;
const total = qtd * 60;

document.getElementById("valorTotal").textContent =
"R$ " + total + ",00";

});

}

/* ==========================================
DOAÇÃO
========================================== */
function enviarDoacaoWhats(){

const nome =
document.getElementById("nomeDoacao")?.value.trim() || "";

const telefone =
document.getElementById("foneDoacao")?.value.trim() || "";

const tipo =
document.getElementById("tipoDoacao")?.value || "";

const descricao =
document.getElementById("descricaoDoacao")?.value || "";

const msg =
`Olá! Quero colaborar com a Festa do Padroeiro São Sebastião.

Nome: ${nome}
Telefone: ${telefone}
Tipo de Doação: ${tipo}
Descrição: ${descricao}`;

const url =
"https://wa.me/556981102306?text=" +
encodeURIComponent(msg);

window.open(url,"_blank");

}

/* ==========================================
NOVIDADES
========================================== */
function salvarNovidade(){

const nome =
document.getElementById("nomeNovidade")?.value.trim() || "";

const fone =
document.getElementById("foneNovidade")?.value.trim() || "";

const cidade =
document.getElementById("cidadeNovidade")?.value.trim() || "";

if(nome === "" || fone === ""){

alert("Preencha nome e WhatsApp.");
return;

}

const msg =
`Olá! Quero receber novidades da festa.

Nome: ${nome}
WhatsApp: ${fone}
Cidade: ${cidade}`;

const url =
"https://wa.me/5569993982037?text=" +
encodeURIComponent(msg);

window.open(url,"_blank");

}

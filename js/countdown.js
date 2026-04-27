/* ==================================================
ARQUIVO: js/countdown.js
CONTADOR REGRESSIVO FPSS
================================================== */

/* DATA DO EVENTO */
const dataEvento = new Date("Jan 24, 2027 10:00:00").getTime();

/* FUNÇÃO PRINCIPAL */
function atualizarContador(){

const agora = new Date().getTime();

const distancia = dataEvento - agora;

/* EVENTO CHEGOU */
if(distancia <= 0){

document.getElementById("countdown").innerHTML =
"<strong>🎉 HOJE É O GRANDE DIA! 🎉</strong>";

return;

}

/* CÁLCULOS */
const dias =
Math.floor(distancia / (1000 * 60 * 60 * 24));

const horas =
Math.floor((distancia % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

const minutos =
Math.floor((distancia % (1000 * 60 * 60)) / (1000 * 60));

const segundos =
Math.floor((distancia % (1000 * 60)) / 1000);

/* INSERE NO HTML */
document.getElementById("dias").textContent = dias;
document.getElementById("horas").textContent = horas;
document.getElementById("minutos").textContent = minutos;
document.getElementById("segundos").textContent = segundos;

}

/* INICIA */
setInterval(atualizarContador,1000);
atualizarContador();
